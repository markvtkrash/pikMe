import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function deterministicId(restaurantName: string, itemName: string): Promise<string> {
  const text = `${restaurantName}::${itemName}::manual`.toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return 'manual_' + hex.slice(0, 24);
}

const MAX_ITEMS = 30;

// Owner-typed item names come in already real — this function never invents
// or drops dish names, it only asks the LLM to estimate nutrition for the
// exact names given. The prompt is explicit that the item list is fixed.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('Unauthorized', 401);

    const { restaurantId, restaurantName, itemNames, force } = await req.json();
    if (!restaurantId || !restaurantName?.trim() || !Array.isArray(itemNames)) {
      return err('restaurantId, restaurantName, and itemNames[] are required', 400);
    }

    // Verify the caller actually owns this restaurant before touching its
    // menu — restaurantId comes straight from the client request body, so
    // without this check any authenticated owner could overwrite any other
    // restaurant's menu just by passing a different id.
    const token = authHeader.replace('Bearer ', '');
    const authedSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authedSupabase.auth.getUser(token);
    if (userError || !userData.user) return err('Unauthorized', 401);

    const serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: restaurant, error: restaurantError } = await serviceSupabase
      .from('restaurants')
      .select('owner_id')
      .eq('id', restaurantId)
      .single();
    if (restaurantError || !restaurant || restaurant.owner_id !== userData.user.id) {
      return err('Forbidden', 403);
    }

    const names = Array.from(
      new Set(
        (itemNames as unknown[])
          .map((n) => String(n ?? '').trim())
          .filter(Boolean)
      )
    ).slice(0, MAX_ITEMS);

    if (names.length === 0) {
      return err('At least one menu item name is required', 400);
    }

    const AI_PROVIDER = Deno.env.get('AI_PROVIDER') ?? 'claude';
    const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001';
    const QUICKSILVER_MODEL = Deno.env.get('QUICKSILVER_MODEL') ?? 'deepseek-v4-flash';

    let apiKey: string;
    if (AI_PROVIDER === 'quicksilver') {
      apiKey = Deno.env.get('QUICKSILVER_API_KEY') || '';
      if (!apiKey) return err('QUICKSILVER_API_KEY secret not configured', 500);
    } else {
      apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
      if (!apiKey) return err('ANTHROPIC_API_KEY secret not configured', 500);
    }

    const prompt = `A restaurant owner for "${restaurantName}" has typed in the following list of REAL menu item names, exactly as they appear on their actual menu. Do not add, remove, rename, or reword any of them — estimate reasonable nutrition values for each one, in the same order.

Menu item names:
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Return ONLY a JSON array with exactly ${names.length} entries, one per item above in the same order, no markdown or explanation. Each entry must have these exact fields with numeric values (no strings):
- name (string, copy the item name exactly as given)
- calories (number)
- protein_g (number)
- totalCarbs_g (number)
- totalFat_g (number)
- saturatedFat_g (number)
- sodium_mg (number)
- dietaryFiber_g (number)
- sugars_g (number)`;

    let rawText: string;
    if (AI_PROVIDER === 'quicksilver') {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const res = await fetch('https://api.quicksilverpro.io/v1/chat/completions', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: QUICKSILVER_MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 2048,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
          const body = await res.text();
          return err(`Quicksilver API error ${res.status}: ${body.slice(0, 200)}`);
        }
        const data = await res.json();
        rawText = data.choices?.[0]?.message?.content ?? '';
      } catch (e) {
        clearTimeout(timeout);
        if (e instanceof Error && e.name === 'AbortError') return err('Quicksilver timed out.');
        throw e;
      }
    } else {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error('[estimate-menu-nutrition] Claude error:', res.status, body);
        return err(`Claude API returned ${res.status}`);
      }
      const claudeData = await res.json();
      rawText = claudeData.content?.[0]?.text ?? '';
    }

    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    let rawItems: unknown[];
    try {
      rawItems = JSON.parse(cleaned);
      if (!Array.isArray(rawItems)) throw new Error('Response is not an array');
    } catch (e) {
      console.error('[estimate-menu-nutrition] JSON parse failed:', e, 'raw:', rawText.slice(0, 500));
      return err('Could not estimate nutrition for those items. Please try again.');
    }

    // The owner's typed names are the source of truth for identity — fall
    // back to them by position rather than trusting whatever name the LLM
    // echoed back, in case it reworded one despite the instruction not to.
    const items = await Promise.all(
      names.map(async (name, idx) => {
        const est = (rawItems[idx] ?? {}) as Record<string, unknown>;
        return {
          itemId: await deterministicId(restaurantName, name),
          restaurantName,
          name,
          imageUrl: null,
          isVerified: true, // owner personally typed this real item name
          nutrition: {
            calories: Math.round(Number(est.calories) || 0),
            totalFat_g: Number(est.totalFat_g) || 0,
            saturatedFat_g: Number(est.saturatedFat_g) || 0,
            sodium_mg: Math.round(Number(est.sodium_mg) || 0),
            totalCarbs_g: Number(est.totalCarbs_g) || 0,
            dietaryFiber_g: Number(est.dietaryFiber_g) || 0,
            sugars_g: Number(est.sugars_g) || 0,
            protein_g: Number(est.protein_g) || 0,
            servingWeightGrams: null,
          },
        };
      })
    );

    // ── Hand off to the shared replace function — same coupon-safety check
    // and delete-then-upsert used by every other menu-replacing path. No
    // menuUrl here, since manual entry has no link to save. ────────────────
    const replaceRes = await fetch(`${Deno.env.get('SUPABASE_URL')!}/functions/v1/replace-restaurant-menu-items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
      },
      body: JSON.stringify({ restaurantId, restaurantName, items, force: !!force }),
    });
    const replaceData = await replaceRes.json();
    if (!replaceRes.ok) {
      return err(replaceData.error || 'Failed to save the menu items', replaceRes.status);
    }

    console.log('[estimate-menu-nutrition] Estimated nutrition for', items.length, 'manual items for', restaurantName);
    return ok(replaceData);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    console.error('[estimate-menu-nutrition] Unhandled error:', e);
    return err(message);
  }
});

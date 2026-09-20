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

// Owner pastes raw menu text (copied from a PDF, email, doc, or a site that
// wouldn't scrape/link cleanly) and this extracts real items from it — same
// "extract only what's really there" discipline as the link/photo paths,
// just skipping the fetch/scrape/vision step since the real text is handed
// to us directly.
const MAX_TEXT_LENGTH = 20000;

async function deterministicId(restaurantName: string, itemName: string): Promise<string> {
  const text = `${restaurantName}::${itemName}::text`.toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return 'text_' + hex.slice(0, 24);
}

interface NormalizedItem {
  itemId: string;
  restaurantName: string;
  name: string;
  imageUrl: null;
  isVerified: boolean;
  nutrition: {
    calories: number;
    totalFat_g: number;
    saturatedFat_g: number;
    sodium_mg: number;
    totalCarbs_g: number;
    dietaryFiber_g: number;
    sugars_g: number;
    protein_g: number;
    servingWeightGrams: number | null;
  };
}

interface ExtractResult {
  items: NormalizedItem[];
  error?: string;
}

async function extractItemsFromText(menuText: string, restaurantName: string): Promise<ExtractResult> {
  const AI_PROVIDER = Deno.env.get('AI_PROVIDER') ?? 'claude';
  const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001';
  const QUICKSILVER_MODEL = Deno.env.get('QUICKSILVER_MODEL') ?? 'deepseek-v4-flash';

  const prompt = `A restaurant owner for "${restaurantName}" pasted the following raw text, copied from their real menu (could be from a PDF, website, email, or document). Extract the ACTUAL menu items explicitly present in this text. Do NOT invent, guess, or add items that aren't there. If this text does not appear to contain a real menu, return an empty JSON array: [].

For each real item found, estimate reasonable nutrition values (this app shows nutrition estimates for restaurant food, so approximate is fine — but the item NAME must be real, taken directly from the text).

Return ONLY a JSON array, no markdown or explanation. Each item must have these exact fields with numeric values (no strings):
- name (string, copied from the real menu text)
- calories (number)
- protein_g (number)
- totalCarbs_g (number)
- totalFat_g (number)
- saturatedFat_g (number)
- sodium_mg (number)
- dietaryFiber_g (number)
- sugars_g (number)

Pasted menu text:
"""
${menuText}
"""`;

  let apiKey: string;
  if (AI_PROVIDER === 'quicksilver') {
    apiKey = Deno.env.get('QUICKSILVER_API_KEY') || '';
    if (!apiKey) throw new Error('QUICKSILVER_API_KEY secret not configured');
  } else {
    apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret not configured');
  }

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
        return { items: [], error: `Quicksilver API error ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = await res.json();
      rawText = data.choices?.[0]?.message?.content ?? '';
    } catch (e) {
      clearTimeout(timeout);
      if (e instanceof Error && e.name === 'AbortError') return { items: [], error: 'Quicksilver timed out.' };
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
      console.error('[extract-menu-from-text] Claude error:', res.status, body);
      return { items: [], error: `Claude API returned ${res.status}` };
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
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    try {
      rawItems = match ? JSON.parse(match[0]) : [];
      if (!Array.isArray(rawItems)) throw new Error('Extracted content is not an array');
    } catch (e2) {
      console.error('[extract-menu-from-text] JSON parse failed:', e2, 'raw:', rawText.slice(0, 500));
      return { items: [], error: "Couldn't find a real menu in that text." };
    }
  }

  const items = await Promise.all(
    (rawItems as Record<string, unknown>[])
      .filter((i) => i.name && typeof i.calories === 'number' && (i.calories as number) > 0)
      .map(async (i) => ({
        itemId: await deterministicId(restaurantName, String(i.name)),
        restaurantName,
        name: String(i.name),
        imageUrl: null,
        isVerified: true, // owner-pasted real text, not invented
        nutrition: {
          calories: Math.round(Number(i.calories) || 0),
          totalFat_g: Number(i.totalFat_g) || 0,
          saturatedFat_g: Number(i.saturatedFat_g) || 0,
          sodium_mg: Math.round(Number(i.sodium_mg) || 0),
          totalCarbs_g: Number(i.totalCarbs_g) || 0,
          dietaryFiber_g: Number(i.dietaryFiber_g) || 0,
          sugars_g: Number(i.sugars_g) || 0,
          protein_g: Number(i.protein_g) || 0,
          servingWeightGrams: i.servingWeightGrams ? Number(i.servingWeightGrams) : null,
        },
      }))
  );

  if (items.length === 0) {
    return { items: [], error: 'No real menu items were found in that text.' };
  }
  return { items };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('Unauthorized', 401);

    const { restaurantId, restaurantName, menuText, force } = await req.json();
    if (!restaurantId || !restaurantName?.trim() || !menuText?.trim()) {
      return err('restaurantId, restaurantName, and menuText are required', 400);
    }
    if (menuText.trim().length < 5) {
      return err('That text is too short to contain real menu items', 400);
    }

    // Verify the caller actually owns this restaurant before touching its
    // menu — restaurantId comes straight from the client request body.
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

    const trimmedText = String(menuText).trim().slice(0, MAX_TEXT_LENGTH);
    const extracted = await extractItemsFromText(trimmedText, restaurantName);
    if (extracted.items.length === 0) {
      return err(extracted.error || 'Could not extract a menu from that text.', 400);
    }
    const items = extracted.items;

    // ── Hand off to the shared replace function — same coupon-orphan check
    // and delete-then-upsert as every other menu source. ────────────────
    const replaceRes = await fetch(`${SUPABASE_URL}/functions/v1/replace-restaurant-menu-items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ restaurantId, restaurantName, items, force: !!force }),
    });
    const replaceData = await replaceRes.json();
    if (!replaceRes.ok) {
      return err(replaceData.error || 'Failed to save the extracted menu', replaceRes.status);
    }

    console.log('[extract-menu-from-text] Extracted', items.length, 'real items for', restaurantName);
    return ok(replaceData);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    console.error('[extract-menu-from-text] Unhandled error:', e);
    return err(message);
  }
});

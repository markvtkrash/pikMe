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
  console.log('[extract-menu-from-text] Using provider:', AI_PROVIDER, 'model:', AI_PROVIDER === 'quicksilver' ? QUICKSILVER_MODEL : CLAUDE_MODEL);

  const prompt = `A restaurant owner for "${restaurantName}" typed or pasted the following text, listing real dish name(s) from their own menu. It may be as short as a single dish name with no prices, descriptions, or formatting — that's still valid; a real menu item name by itself is exactly what you should extract, don't require extra context, structure, or corroborating detail before trusting it as real.

Extract every dish/item name explicitly present in this text, exactly as given. Do NOT invent, guess, or add items that aren't there. Only return an empty JSON array ([]) if the text is genuinely unrelated to food entirely (e.g. random gibberish, a question, an address) — a short or single food/dish name is a valid extraction, not a reason to return [].

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

Example — if the pasted text were just the single word "Dosa" with nothing else, the correct response is NOT an empty array. It's:
[{"name":"Dosa","calories":133,"protein_g":2.7,"totalCarbs_g":22,"totalFat_g":3.7,"saturatedFat_g":0.5,"sodium_mg":220,"dietaryFiber_g":1.2,"sugars_g":0.5}]

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

  // Always log the raw model response before any parsing — otherwise a
  // model that legitimately (or wrongly) returns "[]" leaves no trace of
  // what it actually said, and the eventual "no items" error is
  // undiagnosable from the logs alone.
  console.log('[extract-menu-from-text] Raw model response:', rawText.slice(0, 1000));

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
      .filter((i) => i.name && Number(i.calories) > 0)
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

  if (items.length === 0 && (rawItems as unknown[]).length > 0) {
    // Parsing succeeded and the model returned rows, but every one got
    // filtered out — log the raw rows so a future zero-item report can be
    // diagnosed without needing to reproduce it live.
    console.warn('[extract-menu-from-text] Model returned', (rawItems as unknown[]).length, 'row(s) but all were filtered out. Raw:', JSON.stringify(rawItems).slice(0, 500));
  }

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

    const { restaurantId, restaurantName, menuText, force, items: providedItems } = await req.json();
    if (!restaurantId || !restaurantName?.trim() || !menuText?.trim()) {
      return err('restaurantId, restaurantName, and menuText are required', 400);
    }
    // Just enough to reject empty/junk input (a stray character, whitespace)
    // without rejecting genuinely short real dish names — "idly", "dosa",
    // "pho", "dal" are all 3-4 characters and perfectly valid single items.
    if (menuText.trim().length < 2) {
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

    // If the client already has extracted items from a prior call on this
    // same text (i.e. this is the force:true retry after a coupon-orphan
    // confirmation), reuse them instead of re-running the LLM extraction —
    // that call isn't free, and re-running it is non-deterministic: it can
    // legitimately come back with fewer (or zero) items the second time,
    // which previously surfaced as a confusing failure right after the
    // owner had just confirmed they wanted to proceed.
    let items: unknown[];
    if (Array.isArray(providedItems) && providedItems.length > 0) {
      items = providedItems;
    } else {
      const trimmedText = String(menuText).trim().slice(0, MAX_TEXT_LENGTH);
      const extracted = await extractItemsFromText(trimmedText, restaurantName);
      if (extracted.items.length === 0) {
        return err(extracted.error || 'Could not extract a menu from that text.', 400);
      }
      items = extracted.items;
    }

    // ── Hand off to the shared replace function, scope 'add' — pasted text
    // is often a partial menu, not the full thing, so this adds these items
    // alongside whatever's already cached instead of wiping out everything
    // else (which was silently orphaning coupons tied to items missing from
    // the pasted text). Owners can edit/remove individual items afterward
    // via Manual Entry. ──────────────────────────────────────────────────
    const replaceRes = await fetch(`${SUPABASE_URL}/functions/v1/replace-restaurant-menu-items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ restaurantId, restaurantName, items, force: !!force, scope: 'add' }),
    });
    const replaceData = await replaceRes.json();
    if (!replaceRes.ok) {
      return err(replaceData.error || 'Failed to save the extracted menu', replaceRes.status);
    }

    console.log('[extract-menu-from-text] Extracted', items.length, 'real items for', restaurantName);
    // Send the extracted items back alongside a requiresConfirmation
    // response so a force:true retry can pass them straight back in
    // (see providedItems above) rather than re-extracting from scratch.
    return ok(replaceData.requiresConfirmation ? { ...replaceData, items } : replaceData);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    console.error('[extract-menu-from-text] Unhandled error:', e);
    return err(message);
  }
});

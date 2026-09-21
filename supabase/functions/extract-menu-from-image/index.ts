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

// Owner uploads a photo of their actual physical/printed menu — this reads
// it with a vision-capable model in a single call that does OCR and
// structured extraction together (rather than one call to transcribe the
// image to text and a second call to turn that text into items), which is
// both fewer API calls and avoids losing name/price association across two
// hops. Same "extract only what's really there, [] if nothing legible"
// discipline as extract-menu-from-link's text path, and the same shared
// replace-restaurant-menu-items handoff, so a photo-sourced menu gets the
// exact same coupon-orphan confirmation flow as every other source.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // ~8MB decoded; keep phone photos resized client-side well under this

async function deterministicId(restaurantName: string, itemName: string): Promise<string> {
  const text = `${restaurantName}::${itemName}::photo`.toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return 'photo_' + hex.slice(0, 24);
}

function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
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

async function extractItemsFromImage(
  mediaType: string,
  base64: string,
  restaurantName: string
): Promise<ExtractResult> {
  const AI_PROVIDER = Deno.env.get('AI_PROVIDER') ?? 'claude';
  const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001';
  // Separate from QUICKSILVER_MODEL (used elsewhere for text-only calls,
  // defaults to a non-vision DeepSeek model) so switching this doesn't
  // affect the other AI functions.
  const QUICKSILVER_VISION_MODEL = Deno.env.get('QUICKSILVER_VISION_MODEL') ?? 'qwen3.6-35b';

  const promptText = `This is a photo of a restaurant menu for "${restaurantName}". Read the text visible in the image and extract the ACTUAL menu items you can actually read. Do NOT invent, guess, or add items that aren't legibly present. If you can't read any real menu items in this image, return an empty JSON array: [].

For each real item found, estimate reasonable nutrition values (this app shows nutrition estimates for restaurant food, so approximate is fine — but the item NAME must be real, read directly from the image).

Return ONLY a JSON array, no markdown or explanation. Each item must have these exact fields with numeric values (no strings):
- name (string, copied from the real menu text in the image)
- calories (number)
- protein_g (number)
- totalCarbs_g (number)
- totalFat_g (number)
- saturatedFat_g (number)
- sodium_mg (number)
- dietaryFiber_g (number)
- sugars_g (number)`;

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
          model: QUICKSILVER_VISION_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: promptText },
                { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
              ],
            },
          ],
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
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: promptText },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[extract-menu-from-image] Claude error:', res.status, body);
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
      console.error('[extract-menu-from-image] JSON parse failed:', e2, 'raw:', rawText.slice(0, 500));
      return { items: [], error: "Couldn't read a real menu in that photo." };
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
        isVerified: true, // read from a real photo of the actual menu, not invented
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
    return { items: [], error: 'No real menu items were readable in that photo.' };
  }
  return { items };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('Unauthorized', 401);

    const { restaurantId, restaurantName, imageBase64, force, items: providedItems } = await req.json();
    if (!restaurantId || !restaurantName?.trim() || !imageBase64?.trim()) {
      return err('restaurantId, restaurantName, and imageBase64 are required', 400);
    }

    const parsed = parseDataUrl(imageBase64);
    if (!parsed) {
      return err('imageBase64 must be a data URL (e.g. "data:image/jpeg;base64,...")', 400);
    }
    if (!parsed.mediaType.startsWith('image/')) {
      return err('That file is not an image', 400);
    }
    // Rough decoded-size check without actually decoding: base64 is ~4/3 the
    // size of the raw bytes.
    if (parsed.base64.length * 0.75 > MAX_IMAGE_BYTES) {
      return err('That image is too large — please use a smaller photo (under ~8MB).', 400);
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

    // Reuse items from a prior call on this same photo instead of re-running
    // the vision extraction — that call isn't free, and it's non-
    // deterministic, so a force:true retry (after a coupon-orphan
    // confirmation) could legitimately come back with fewer/zero items on a
    // second pass, surfacing as a confusing failure right after the owner
    // just confirmed they wanted to proceed.
    let items: unknown[];
    if (Array.isArray(providedItems) && providedItems.length > 0) {
      items = providedItems;
    } else {
      const extracted = await extractItemsFromImage(parsed.mediaType, parsed.base64, restaurantName);
      if (extracted.items.length === 0) {
        return err(extracted.error || 'Could not extract a menu from that photo.', 400);
      }
      items = extracted.items;
    }

    // ── Hand off to the shared replace function, scope 'add' — a photo often
    // only shows part of the menu, so this adds these items alongside
    // whatever's already cached instead of wiping out everything else (which
    // was silently orphaning coupons tied to items missing from the photo).
    // Owners can edit/remove individual items afterward via Manual Entry.
    // No menuUrl here — there's no link to persist for a photo-sourced menu.
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

    console.log('[extract-menu-from-image] Extracted', items.length, 'real items for', restaurantName);
    return ok(replaceData.requiresConfirmation ? { ...replaceData, items } : replaceData);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    console.error('[extract-menu-from-image] Unhandled error:', e);
    return err(message);
  }
});

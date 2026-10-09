import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildMenuGuessPrompt, formatCuisine, formatLocation, parseGuessReply, parseMenuGuessMaxTokens, pickModel,
} from './promptUtils.ts';

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

// Cached per warm isolate (not per-request) so switching APP_CONFIG_SOURCE=db
// on doesn't add a DB round-trip to every single invocation — refreshed only
// on the next cold start, same "load once" model used by the client apps.
let cachedDbConfig: Record<string, string> | null = null;
// The config is kept for a few minutes, then read again, so a changed setting applies without a redeploy. The cache is for
// one list of keys: a call with a different list reads again.
let cachedDbConfigAt = 0;
let cachedDbConfigSig = '';
const DB_CONFIG_TTL_MS = 5 * 60 * 1000;
async function loadDbConfig(keys: string[]): Promise<Record<string, string>> {
  if (Deno.env.get('APP_CONFIG_SOURCE') !== 'db') return {};
  const sig = [...keys].sort().join(',');
  if (cachedDbConfig && cachedDbConfigSig === sig && Date.now() - cachedDbConfigAt < DB_CONFIG_TTL_MS) return cachedDbConfig;
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data, error } = await client.from('app_config').select('key, value').in('key', keys);
    if (error) throw error;
    cachedDbConfig = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    cachedDbConfigAt = Date.now();
    cachedDbConfigSig = sig;
    return cachedDbConfig;
  } catch (loadErr) {
    console.error('[fetch-menu-items-ai] Failed to load DB config, falling back to env/defaults:', loadErr);
    return {};
  }
}

async function deterministicId(restaurantName: string, itemName: string): Promise<string> {
  const text = `${restaurantName}::${itemName}`.toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return 'ai_' + hex.slice(0, 24);
}

function mapDbRow(row: Record<string, unknown>) {
  return {
    itemId: row.item_id,
    restaurantName: row.restaurant_name,
    name: row.name,
    imageUrl: null,
    isVerified: false,
    nutrition: {
      calories: row.calories,
      totalFat_g: row.total_fat_g,
      saturatedFat_g: row.saturated_fat_g,
      sodium_mg: row.sodium_mg,
      totalCarbs_g: row.total_carbs_g,
      dietaryFiber_g: 0,
      sugars_g: 0,
      protein_g: row.protein_g,
      servingWeightGrams: row.serving_weight_grams ?? null,
    },
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // placeId is sent only when a customer actually opened this restaurant (not for a bulk list): it is
    // what puts the restaurant in the menu build queue (migration 101).
    const { restaurantName, placeId } = await req.json();
    if (!restaurantName?.trim()) return err('restaurantName is required', 400);

    const dbConfig = await loadDbConfig(['aiProvider', 'quicksilverModel', 'claudeModel', 'menuItemsCount', 'menuGuessMaxTokens', 'menuGuessModel']);
    const MAX_TOKENS = parseMenuGuessMaxTokens(dbConfig.menuGuessMaxTokens, Deno.env.get('MENU_GUESS_MAX_TOKENS'));
    const AI_PROVIDER = dbConfig.aiProvider ?? Deno.env.get('AI_PROVIDER') ?? 'claude';
    // A model chosen just for this guess (the menuGuessModel setting) wins over the app-wide model of the active
    // provider; blank or invalid means "use the app-wide model", as before.
    const GUESS_MODEL = pickModel(dbConfig.menuGuessModel, Deno.env.get('MENU_GUESS_MODEL'));
    const QUICKSILVER_MODEL = GUESS_MODEL ?? dbConfig.quicksilverModel ?? Deno.env.get('QUICKSILVER_MODEL') ?? 'deepseek-v4-flash';
    const CLAUDE_MODEL = GUESS_MODEL ?? dbConfig.claudeModel ?? Deno.env.get('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001';
    const MENU_ITEMS_COUNT = parseInt(dbConfig.menuItemsCount ?? Deno.env.get('MENU_ITEMS_COUNT') ?? '15', 10);

    // Note: Menu items are AI-generated (not from Google)
    // Caching is compliant with Google Maps Platform ToS
    let apiKey: string;

    if (AI_PROVIDER === 'quicksilver') {
      apiKey = Deno.env.get('QUICKSILVER_API_KEY') || '';
      if (!apiKey) return err('QUICKSILVER_API_KEY secret not configured', 500);
    } else {
      apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
      if (!apiKey) return err('ANTHROPIC_API_KEY secret not configured', 500);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Queue a real menu build for this restaurant ─────────────────────────────
    // Best effort: whatever happens here, the customer still gets the AI menu below. The database only accepts
    // places that exist in the Google cache, so a made-up ID is ignored. It runs on the server, not in the app.
    if (typeof placeId === 'string' && placeId.length > 0) {
      try {
        const { data: queued, error: queueError } = await supabase.rpc('enqueue_menu_build', {
          p_place_id: placeId,
          p_restaurant_name: restaurantName.trim(),
        });
        if (queueError) console.warn('[fetch-menu-items-ai] could not queue a menu build:', queueError.message);
        else console.log('[fetch-menu-items-ai] menu build queue:', queued);
      } catch (queueErr) {
        console.warn('[fetch-menu-items-ai] could not queue a menu build:', queueErr instanceof Error ? queueErr.message : 'error');
      }
    }

    // ── An independent restaurant's guess belongs to ITS place, never to every restaurant with the name ──
    // (A franchise, or a call with no place, keeps the old name-keyed behaviour below.)
    let ownPlaceId: string | null = null;
    if (typeof placeId === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(placeId)) {
      const { data: isChain, error: chainError } = await supabase.rpc('is_franchise_chain', { p_name: restaurantName.trim() });
      if (!chainError && isChain === false) ownPlaceId = placeId;
    }

    // ── Check 30-day cache ──────────────────────────────────────────────────────
    const cacheFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const cachedQuery = ownPlaceId
      ? supabase.from('menu_items').select('*').eq('place_id', ownPlaceId).like('item_id', 'ai_*')
      : supabase.from('menu_items').select('*').ilike('restaurant_name', restaurantName.trim()).eq('is_verified', false);
    const { data: cached } = await cachedQuery.gt('cached_at', cacheFrom).limit(50);

    if (cached && cached.length > 0) {
      return ok(cached.map(mapDbRow));
    }

    // ── Where is this restaurant? ───────────────────────────────────────────────
    // Only needed now that the AI really has to be called (not on a cache hit), and only for an independent:
    // read the address and category from our own cached Google place, never from the request. No address (not cached, or
    // blank) just means the old name-only prompt.
    let location: string | null = null;
    let cuisine: string | null = null;
    if (ownPlaceId) {
      try {
        const { data: place } = await supabase
          .from('cached_restaurants')
          .select('address, city, cuisine_types')
          .eq('place_id', ownPlaceId)
          .maybeSingle();
        location = formatLocation(place?.address, place?.city);
        cuisine = formatCuisine(place?.cuisine_types);
      } catch (placeErr) {
        console.warn('[fetch-menu-items-ai] could not read the place address:', placeErr instanceof Error ? placeErr.message : 'error');
      }
    }

    // ── Call LLM API ────────────────────────────────────────────────────────
    const prompt = buildMenuGuessPrompt(restaurantName, MENU_ITEMS_COUNT, location, cuisine);

    console.log('[fetch-menu-items-ai] ========== START ==========');
    console.log('[fetch-menu-items-ai] Fetching menu for:', restaurantName);
    console.log('[fetch-menu-items-ai] Items requested:', MENU_ITEMS_COUNT);
    console.log('[fetch-menu-items-ai] Provider:', AI_PROVIDER, 'model:', AI_PROVIDER === 'quicksilver' ? QUICKSILVER_MODEL : CLAUDE_MODEL, GUESS_MODEL ? '(menuGuessModel)' : '(app-wide model)');
    console.log('[fetch-menu-items-ai] [ai-request]', prompt);

    let rawText: string;
    const startTime = Date.now();

    if (AI_PROVIDER === 'quicksilver') {
      console.log('[fetch-menu-items-ai] Starting Quicksilver request...');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const startTime = Date.now();

      try {
        console.log('[fetch-menu-items-ai] Calling Quicksilver API...');
        const res = await fetch('https://api.quicksilverpro.io/v1/chat/completions', {
          method: 'POST',
          headers: {
            'authorization': `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: QUICKSILVER_MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: MAX_TOKENS,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        const elapsed = Date.now() - startTime;
        console.log(`[fetch-menu-items-ai] Quicksilver responded in ${elapsed}ms with status ${res.status}`);

        if (!res.ok) {
          const body = await res.text();
          console.error('[fetch-menu-items-ai] Quicksilver error:', res.status, body);
          return err(`Quicksilver API error ${res.status}: ${body.slice(0, 200)}`);
        }

        const data = await res.json();
        rawText = data.choices?.[0]?.message?.content ?? '';
        console.log('[fetch-menu-items-ai] Quicksilver full response:', rawText);
      } catch (e) {
        clearTimeout(timeout);
        const elapsed = Date.now() - startTime;
        if (e instanceof Error && e.name === 'AbortError') {
          console.error(`[fetch-menu-items-ai] Quicksilver timeout after ${elapsed}ms`);
          return err('Quicksilver timed out. Try using Claude instead.');
        }
        console.error(`[fetch-menu-items-ai] Quicksilver error after ${elapsed}ms:`, e);
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
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error('[fetch-menu-items-ai] Claude error:', res.status, body);
        return err(`Claude API returned ${res.status}`);
      }

      const claudeData = await res.json();
      rawText = claudeData.content?.[0]?.text ?? '';
      console.log('[fetch-menu-items-ai] Claude full response:', rawText);
      console.log('[fetch-menu-items-ai] Claude usage - input:', claudeData.usage?.input_tokens, 'output:', claudeData.usage?.output_tokens);
    }

    // Strip accidental markdown fences Claude might include
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    console.log('[fetch-menu-items-ai] Response length:', cleaned.length);
    console.log('[fetch-menu-items-ai] Parsed text (first 300 chars):', cleaned.slice(0, 300));
    console.log('[fetch-menu-items-ai] Parsed text (last 200 chars):', cleaned.slice(-200));

    // A reply cut off at the length cap still gives the complete items before the cut.
    const parsed = parseGuessReply(rawText);
    if (!parsed) {
      console.error('[fetch-menu-items-ai] JSON parse failed. Full raw response length:', rawText.length);
      console.error('[fetch-menu-items-ai] Full raw response:', rawText);
      return err(`The AI reply could not be read. Length: ${cleaned.length}. If it was cut off, raise the menuGuessMaxTokens setting.`);
    }
    const rawItems = parsed.items;
    if (parsed.recovered) {
      console.warn('[fetch-menu-items-ai] The reply was cut off; kept', rawItems.length, 'complete items. Raise menuGuessMaxTokens (now', MAX_TOKENS, ').');
    } else {
      console.log('[fetch-menu-items-ai] Successfully parsed', rawItems.length, 'items');
    }

    const items = await Promise.all(
      (rawItems as Record<string, unknown>[])
        .filter((i) => i.name && Number(i.calories) > 0)
        .map(async (i) => ({
          itemId: await deterministicId(restaurantName, String(i.name)),
          restaurantName,
          name: String(i.name),
          imageUrl: null,
          isVerified: false,
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

    // ── Cache in DB (best-effort) ──────────────────────────────────────────────
    if (items.length > 0) {
      const dbPayload = items.map((item) => ({
        itemId: item.itemId,
        restaurantName: item.restaurantName,
        name: item.name,
        servingWeightGrams: item.nutrition.servingWeightGrams,
        calories: item.nutrition.calories,
        totalFat_g: item.nutrition.totalFat_g,
        saturatedFat_g: item.nutrition.saturatedFat_g,
        sodium_mg: item.nutrition.sodium_mg,
        totalCarbs_g: item.nutrition.totalCarbs_g,
        protein_g: item.nutrition.protein_g,
        imageUrl: null,
        isVerified: false,
      }));
      if (ownPlaceId) {
        // tied to this restaurant's place (ids stay ai_...), so it is replaced when a real menu is built
        const { error: placeSaveError } = await supabase.rpc('upsert_place_menu_items', {
          p_place_id: ownPlaceId,
          p_restaurant_name: restaurantName.trim(),
          p_items: dbPayload,
        });
        if (placeSaveError) console.warn('[fetch-menu-items-ai] could not save the guess for the place:', placeSaveError.message);
      } else {
        await supabase.rpc('upsert_menu_items', { p_items: dbPayload });
      }
    }

    console.log('[fetch-menu-items-ai] Generated', items.length, 'items');
    console.log('[fetch-menu-items-ai] ========== END ==========');
    return ok(items);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return err(message);
  }
});

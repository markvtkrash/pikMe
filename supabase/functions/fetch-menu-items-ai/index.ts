import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    const { restaurantName } = await req.json();
    if (!restaurantName?.trim()) return err('restaurantName is required', 400);

    const AI_PROVIDER = Deno.env.get('AI_PROVIDER') ?? 'claude';
    const QUICKSILVER_MODEL = Deno.env.get('QUICKSILVER_MODEL') ?? 'deepseek-v4-flash';
    const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001';
    const MENU_ITEMS_COUNT = parseInt(Deno.env.get('MENU_ITEMS_COUNT') ?? '15', 10);

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

    // ── Check 30-day cache ──────────────────────────────────────────────────────
    const cacheFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: cached } = await supabase
      .from('menu_items')
      .select('*')
      .ilike('restaurant_name', `%${restaurantName.split(' ')[0]}%`)
      .eq('is_verified', false)
      .gt('cached_at', cacheFrom)
      .limit(50);

    if (cached && cached.length > 0) {
      return ok(cached.map(mapDbRow));
    }

    // ── Call LLM API ────────────────────────────────────────────────────────
    const prompt = `You are a personalized food recommendation assistant. Select the top ${MENU_ITEMS_COUNT} menu items from "${restaurantName}" that best match typical health-conscious preferences (nutritious, balanced, popular). Return ONLY a JSON array with no markdown, code fences, or explanation.

These are the top ${MENU_ITEMS_COUNT} menu items for you to explore based on nutritional balance and popularity.

Each item must have these exact fields with numeric values (no strings):
- name (string)
- calories (number)
- protein_g (number)
- totalCarbs_g (number)
- totalFat_g (number)
- saturatedFat_g (number)
- sodium_mg (number)
- dietaryFiber_g (number)
- sugars_g (number)

Example: [{"name":"Grilled Chicken","calories":350,"protein_g":45,"totalCarbs_g":0,"totalFat_g":8,"saturatedFat_g":2,"sodium_mg":800,"dietaryFiber_g":0,"sugars_g":0}]`;

    console.log('[fetch-menu-items-ai] ========== START ==========');
    console.log('[fetch-menu-items-ai] Fetching menu for:', restaurantName);
    console.log('[fetch-menu-items-ai] Items requested:', MENU_ITEMS_COUNT);
    console.log('[fetch-menu-items-ai] Provider:', AI_PROVIDER);
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
            max_tokens: 1536,
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
          max_tokens: 1024,
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

    let rawItems: unknown[];
    try {
      console.log('[fetch-menu-items-ai] Response length:', cleaned.length);
      console.log('[fetch-menu-items-ai] Parsed text (first 300 chars):', cleaned.slice(0, 300));
      console.log('[fetch-menu-items-ai] Parsed text (last 200 chars):', cleaned.slice(-200));

      rawItems = JSON.parse(cleaned);
      if (!Array.isArray(rawItems)) throw new Error('Response is not an array');
      console.log('[fetch-menu-items-ai] Successfully parsed', rawItems.length, 'items');
    } catch (e) {
      console.error('[fetch-menu-items-ai] JSON parse failed:', e);
      console.error('[fetch-menu-items-ai] Full raw response length:', rawText.length);
      console.error('[fetch-menu-items-ai] Full raw response:', rawText);
      console.error('[fetch-menu-items-ai] Full cleaned response:', cleaned);
      return err(`Could not parse JSON. Length: ${cleaned.length}. Error: ${e instanceof Error ? e.message : String(e)}`);
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
      await supabase.rpc('upsert_menu_items', { p_items: dbPayload });
    }

    console.log('[fetch-menu-items-ai] Generated', items.length, 'items');
    console.log('[fetch-menu-items-ai] ========== END ==========');
    return ok(items);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return err(message);
  }
});

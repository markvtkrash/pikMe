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

function mapDbRow(row: Record<string, unknown>) {
  return {
    itemId: row.item_id,
    restaurantName: row.restaurant_name,
    name: row.name,
    imageUrl: row.image_url ?? null,
    isVerified: row.is_verified ?? true,
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

// Return true when the brand name plausibly matches the queried restaurant name
function brandMatches(brandName: string, query: string): boolean {
  const b = brandName.toLowerCase().trim();
  const q = query.toLowerCase().trim();
  if (b === q) return true;
  if (b.includes(q) || q.includes(b)) return true;
  // Compare first significant word (≥4 chars)
  const words = q.split(/\s+/).filter((w) => w.length >= 4);
  return words.some((w) => b.includes(w));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { restaurantName } = await req.json();
    if (!restaurantName?.trim()) return err('restaurantName is required', 400);

    const NIX_APP_ID = Deno.env.get('NUTRITIONIX_APP_ID');
    const NIX_APP_KEY = Deno.env.get('NUTRITIONIX_APP_KEY');
    if (!NIX_APP_ID || !NIX_APP_KEY) {
      return err('NUTRITIONIX_APP_ID or NUTRITIONIX_APP_KEY secret not configured', 500);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Check 7-day cache ──────────────────────────────────────────────────────
    const cacheFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: cached } = await supabase
      .from('menu_items')
      .select('*')
      .ilike('restaurant_name', `%${restaurantName.split(' ')[0]}%`)
      .gt('cached_at', cacheFrom)
      .limit(50);

    if (cached && cached.length > 0) {
      return ok(cached.map(mapDbRow));
    }

    // ── Fetch from Nutritionix ─────────────────────────────────────────────────
    const nixUrl =
      `https://trackapi.nutritionix.com/v2/search/instant` +
      `?query=${encodeURIComponent(restaurantName)}&branded=true&self=false&common=false&detailed=true`;

    const nixRes = await fetch(nixUrl, {
      headers: {
        'x-app-id': NIX_APP_ID,
        'x-app-key': NIX_APP_KEY,
        'x-remote-user-id': '0',
      },
    });

    if (!nixRes.ok) {
      // Non-chain restaurants simply return an empty list
      console.warn(`[fetch-menu-items] Nutritionix ${nixRes.status} for "${restaurantName}"`);
      return ok([]);
    }

    const { branded = [] } = await nixRes.json();

    // Filter to items whose brand_name matches the restaurant
    const matched = (branded as Record<string, unknown>[]).filter((item) =>
      brandMatches(String(item.brand_name ?? ''), restaurantName)
    );

    const source = matched.length > 0 ? matched : branded;

    const items = (source as Record<string, unknown>[])
      .slice(0, 50)
      .map((item) => ({
        itemId: String(item.item_id ?? item.tag_id ?? crypto.randomUUID()),
        restaurantName: String(item.brand_name ?? restaurantName),
        name: String(item.food_name ?? ''),
        imageUrl: (item.photo as Record<string, string> | undefined)?.thumb ?? null,
        isVerified: true,
        nutrition: {
          calories: Math.round(Number(item.nf_calories) || 0),
          totalFat_g: Number(item.nf_total_fat) || 0,
          saturatedFat_g: Number(item.nf_saturated_fat) || 0,
          sodium_mg: Math.round(Number(item.nf_sodium) || 0),
          totalCarbs_g: Number(item.nf_total_carbohydrate) || 0,
          dietaryFiber_g: Number(item.nf_dietary_fiber) || 0,
          sugars_g: Number(item.nf_sugars) || 0,
          protein_g: Number(item.nf_protein) || 0,
          servingWeightGrams: item.serving_weight_grams
            ? Number(item.serving_weight_grams)
            : null,
        },
      }))
      .filter((i) => i.nutrition.calories > 0 && i.name);

    // ── Cache in DB (best-effort) ──────────────────────────────────────────────
    if (items.length > 0) {
      const dbPayload = items.map((i) => ({
        itemId: i.itemId,
        restaurantName: i.restaurantName,
        name: i.name,
        servingWeightGrams: i.nutrition.servingWeightGrams,
        calories: i.nutrition.calories,
        totalFat_g: i.nutrition.totalFat_g,
        saturatedFat_g: i.nutrition.saturatedFat_g,
        sodium_mg: i.nutrition.sodium_mg,
        totalCarbs_g: i.nutrition.totalCarbs_g,
        protein_g: i.nutrition.protein_g,
        imageUrl: i.imageUrl,
        isVerified: true,
      }));
      await supabase.rpc('upsert_menu_items', { p_items: dbPayload });
    }

    return ok(items);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return err(message);
  }
});

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

interface NormalizedItem {
  itemId: string;
  restaurantName: string;
  name: string;
  imageUrl: string | null;
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

// Shared core for every path that replaces a restaurant's real menu data
// (link extraction now, manual entry later, AI-refresh going forward) —
// one place that owns the "is this safe to delete" check and the actual
// delete-then-upsert, so none of the callers have to duplicate it.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { restaurantId, restaurantName, items, menuUrl, force, scope } = await req.json();
    if (!restaurantId || !restaurantName?.trim() || !Array.isArray(items)) {
      return err('restaurantId, restaurantName, and items[] are required', 400);
    }
    // 'all' (default) replaces everything for this restaurant — used by link
    // extraction, manual entry, and a full AI refresh. 'unverified_only' is
    // for a partial AI refresh: verified items (link/manual/already-verified
    // AI guesses) are structurally untouched, only currently-unverified rows
    // are cleared and replaced with a fresh AI-guessed batch.
    const replaceScope: 'all' | 'unverified_only' = scope === 'unverified_only' ? 'unverified_only' : 'all';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const namePattern = `%${restaurantName.split(' ')[0]}%`;

    // ── Find what's currently cached for this restaurant ────────────────────
    const { data: allCurrentItems, error: currentItemsError } = await supabase
      .from('menu_items')
      .select('item_id, is_verified')
      .ilike('restaurant_name', namePattern);

    if (currentItemsError) {
      console.error('[replace-restaurant-menu-items] Failed to read current items:', currentItemsError);
      return err('Failed to check existing menu items');
    }

    // In unverified_only scope, only the unverified rows are actually in
    // play — verified rows are never read for the coupon check or touched by
    // the delete below, so there is nothing to warn about for them.
    const currentItems =
      replaceScope === 'unverified_only'
        ? (allCurrentItems ?? []).filter((r) => !r.is_verified)
        : (allCurrentItems ?? []);
    const currentItemIds = currentItems.map((r) => r.item_id);

    // A full refresh (AI-guessed, isVerified: false on every incoming item)
    // is about to silently downgrade real data — link-extracted or manually
    // typed items the owner already confirmed are accurate — back into
    // unverified guesses. That's worth its own warning, independent of
    // whether any coupons happen to be affected. Doesn't apply in
    // unverified_only scope, which by construction never touches a verified row.
    const verifiedCount = replaceScope === 'all' ? currentItems.filter((r) => r.is_verified).length : 0;
    const incomingIsUnverified =
      items.length === 0 || (items as NormalizedItem[]).every((i) => !i.isVerified);
    const overwritesVerified = replaceScope === 'all' && verifiedCount > 0 && incomingIsUnverified;

    // ── Check for coupons that would be orphaned by removing those items ────
    let affectedCoupons: { id: string; coupon_code: string }[] = [];
    if (currentItemIds.length > 0) {
      const { data, error: couponsError } = await supabase
        .from('coupons')
        .select('id, coupon_code, menu_item_id')
        .in('menu_item_id', currentItemIds)
        .eq('is_deleted', false)
        .in('coupon_type', ['item_percent', 'item_fixed']);

      if (couponsError) {
        console.error('[replace-restaurant-menu-items] Failed to check coupons:', couponsError);
        return err('Failed to check existing coupons');
      }
      affectedCoupons = data ?? [];
    }

    if ((affectedCoupons.length > 0 || overwritesVerified) && !force) {
      return ok({
        requiresConfirmation: true,
        affectedCoupons: affectedCoupons.map((c) => ({ id: c.id, couponCode: c.coupon_code })),
        overwritesVerifiedCount: overwritesVerified ? verifiedCount : 0,
      });
    }

    // ── Clean out the stale items, then write the new ones ───────────────────
    let deleteQuery = supabase.from('menu_items').delete().ilike('restaurant_name', namePattern);
    if (replaceScope === 'unverified_only') {
      deleteQuery = deleteQuery.eq('is_verified', false);
    }
    const { error: deleteError } = await deleteQuery;
    if (deleteError) {
      console.error('[replace-restaurant-menu-items] Delete failed:', deleteError);
      return err('Failed to clear stale menu items');
    }

    if (items.length > 0) {
      const dbPayload = (items as NormalizedItem[]).map((item) => ({
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
        imageUrl: item.imageUrl,
        isVerified: item.isVerified,
      }));
      const { error: upsertError } = await supabase.rpc('upsert_menu_items', { p_items: dbPayload });
      if (upsertError) {
        console.error('[replace-restaurant-menu-items] Upsert failed:', upsertError);
        return err('Cleared old items but failed to save the new ones. Please try again.');
      }
    }

    if (menuUrl) {
      const { error: updateError } = await supabase
        .from('restaurants')
        .update({ menu_link: menuUrl, updated_at: new Date().toISOString() })
        .eq('id', restaurantId);
      if (updateError) {
        console.error('[replace-restaurant-menu-items] Failed to save menu_link (items were still saved):', updateError);
      }
    }

    console.log('[replace-restaurant-menu-items] Replaced menu for', restaurantName, 'with', items.length, 'items');
    return ok({ success: true, itemCount: items.length });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    console.error('[replace-restaurant-menu-items] Unhandled error:', e);
    return err(message);
  }
});

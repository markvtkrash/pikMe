import { useQuery } from '@tanstack/react-query';
import { fetchMenuItemsAi } from '../api/functions';
import { scoreAndRankItems } from '../engine/recommendation';
import { useUserProfile } from './useUserProfile';
import { useShowUnconfirmedMenuItems } from './useShowUnconfirmedMenuItems';
import { useIsFranchise } from './useIsFranchise';
import { supabase } from '../api/supabase';
import type { Restaurant, Recommendation } from '../types';

export function useMenuRecommendations(restaurant: Restaurant | null, couponItemIds?: Set<string>) {
  const { data: profile } = useUserProfile();
  // Defaults to false (only confirmed items) while the flag is still
  // loading — the safe default, consistent with the flag's own fallback.
  const { data: showUnconfirmed = false } = useShowUnconfirmedMenuItems();
  // Known franchises/chains (migration 062) may show AI-estimated items even
  // when the global flag is off; everything else is confirmed-only.
  const { data: isFranchise } = useIsFranchise(restaurant?.name);
  // Sorted + joined so the query key is stable regardless of Set iteration
  // order, and only actually changes (triggering a refetch) when the set of
  // coupon item ids itself changes.
  const couponKey = couponItemIds ? Array.from(couponItemIds).sort().join(',') : '';

  return useQuery<Recommendation[]>({
    queryKey: ['menuRecommendations', restaurant?.placeId, couponKey, showUnconfirmed, isFranchise],
    queryFn: async () => {
      if (!restaurant || !profile) return [];

      // First, try to get items from database cache (menu_items)
      console.log('[menuRecommendations] Fetching from database for restaurant:', restaurant.name);
      const { data: cachedItems, error: dbError } = await supabase
        .from('menu_items')
        .select('*')
        .eq('restaurant_name', restaurant.name)
        .eq('is_out_of_stock', false);

      let items = [];

      if (cachedItems && cachedItems.length > 0) {
        console.log('[menuRecommendations] Found', cachedItems.length, 'items in database cache');
        // Convert database format to API format
        items = cachedItems.map(item => ({
          itemId: item.item_id,
          name: item.name,
          restaurantName: item.restaurant_name,
          nutrition: {
            calories: item.calories,
            totalFat_g: item.total_fat_g,
            saturatedFat_g: item.saturated_fat_g,
            sodium_mg: item.sodium_mg,
            totalCarbs_g: item.total_carbs_g,
            dietaryFiber_g: item.dietary_fiber_g ?? 0,
            sugars_g: item.sugars_g ?? 0,
            protein_g: item.protein_g,
            servingWeightGrams: item.serving_weight_grams,
          },
          imageUrl: item.image_url,
          isVerified: item.is_verified,
          nutritionSource: item.nutrition_source,
        }));
      } else {
        // Fallback: fetch from API if no cached items
        console.log('[menuRecommendations] No cached items, fetching from API');
        items = await fetchMenuItemsAi(restaurant.name);
      }

      // AI-guessed fallback items are always unverified by construction, so
      // this one filter covers both "real but not yet confirmed" items from
      // the cache AND the AI-invented fallback above — when the flag is off
      // and the restaurant isn't a known franchise, neither should reach the
      // customer. See migrations 059 and 062.
      console.log('[menuRecommendations] showUnconfirmed flag:', showUnconfirmed, 'isFranchise:', isFranchise, '— items before filter:', items.length, items.map((i: any) => ({ name: i.name, isVerified: i.isVerified })));
      if (!showUnconfirmed && !isFranchise) {
        items = items.filter((item: { isVerified?: boolean }) => item.isVerified);
      }
      console.log('[menuRecommendations] items after filter:', items.length);

      if (!items.length) return [];
      return scoreAndRankItems(profile, items, restaurant, couponItemIds);
    },
    // Wait for the franchise lookup so a chain's items don't flash in
    // filtered, then re-fetch once the answer arrives.
    enabled: !!restaurant && !!profile && isFranchise !== undefined,
    staleTime: 10 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: 1,
  });
}

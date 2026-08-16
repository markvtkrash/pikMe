import { useQuery } from '@tanstack/react-query';
import { fetchMenuItemsAi } from '../api/functions';
import { scoreAndRankItems } from '../engine/recommendation';
import { useUserProfile } from './useUserProfile';
import { supabase } from '../api/supabase';
import type { Restaurant, Recommendation } from '../types';

export function useMenuRecommendations(restaurant: Restaurant | null) {
  const { data: profile } = useUserProfile();

  return useQuery<Recommendation[]>({
    queryKey: ['menuRecommendations', restaurant?.placeId],
    queryFn: async () => {
      if (!restaurant || !profile) return [];

      // First, try to get items from database cache (menu_items)
      console.log('[menuRecommendations] Fetching from database for restaurant:', restaurant.name);
      const { data: cachedItems, error: dbError } = await supabase
        .from('menu_items')
        .select('*')
        .eq('restaurant_name', restaurant.name);

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
            protein_g: item.protein_g,
            servingWeightGrams: item.serving_weight_grams,
          },
          imageUrl: item.image_url,
          isVerified: item.is_verified,
        }));
      } else {
        // Fallback: fetch from API if no cached items
        console.log('[menuRecommendations] No cached items, fetching from API');
        items = await fetchMenuItemsAi(restaurant.name);
      }

      if (!items.length) return [];
      return scoreAndRankItems(profile, items, restaurant);
    },
    enabled: !!restaurant && !!profile,
    staleTime: 10 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: 1,
  });
}

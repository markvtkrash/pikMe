import { useQuery } from '@tanstack/react-query';
import { fetchMenuItemsAi } from '../api/functions';
import type { Restaurant, MenuItem, Recommendation } from '../types';
import { scoreAndRankItems } from '../engine/recommendation';

export function useSmartFilterItems(restaurants: Restaurant[] | null, userProfile: any | null) {
  return useQuery({
    queryKey: ['smartFilterItems', restaurants?.map(r => r.placeId).join(','), userProfile?.id],
    queryFn: async () => {
      if (!restaurants || restaurants.length === 0 || !userProfile) return [];

      try {
        const allMenuItems: MenuItem[] = [];

        // Fetch menu items for each restaurant
        for (const restaurant of restaurants) {
          try {
            const items = await fetchMenuItemsAi(restaurant.name);
            allMenuItems.push(...items);
          } catch (err) {
            console.warn(`Failed to fetch menu for ${restaurant.name}:`, err);
            // Continue with other restaurants
          }
        }

        // Score and rank items based on user profile
        const scored = scoreAndRankItems(userProfile, allMenuItems);
        return scored;
      } catch (err) {
        console.error('Error fetching smart filter items:', err);
        return [];
      }
    },
    enabled: !!restaurants && restaurants.length > 0 && !!userProfile,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

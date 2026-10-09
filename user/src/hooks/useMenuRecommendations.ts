import { useQuery } from '@tanstack/react-query';
import { fetchMenuItemsAi } from '../api/functions';
import { scoreAndRankItems } from '../engine/recommendation';
import { useUserProfile } from './useUserProfile';
import { useShowUnconfirmedMenuItems } from './useShowUnconfirmedMenuItems';
import { useIsFranchise } from './useIsFranchise';
import { fetchStoredMenuItems } from '../api/menuItems';
import { filterVisibleMenuItems } from '../utils/menuVisibility';
import type { Restaurant, Recommendation, MenuItem } from '../types';

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

      // First, try the menu already stored for this restaurant: its own
      // location menu if it has one, else the shared name-keyed template
      // (see fetchStoredMenuItems / migration 067).
      console.log('[menuRecommendations] Fetching from database for restaurant:', restaurant.name);
      let items: MenuItem[] = await fetchStoredMenuItems(restaurant);

      if (items.length > 0) {
        console.log('[menuRecommendations] Found', items.length, 'items in database');
      } else {
        // Fallback: fetch from API if nothing is stored
        console.log('[menuRecommendations] No stored items, fetching from API');
        // The customer opened this restaurant: pass its place so a real menu build is queued for it.
        items = await fetchMenuItemsAi(restaurant.name, restaurant.placeId);
      }

      // AI-guessed fallback items are always unverified by construction, so
      // this one filter covers both "real but not yet confirmed" stored items
      // AND the AI-invented fallback above. See migrations 059 and 062 and
      // filterVisibleMenuItems for the rule.
      console.log('[menuRecommendations] showUnconfirmed flag:', showUnconfirmed, 'isFranchise:', isFranchise, '— items before filter:', items.length);
      items = filterVisibleMenuItems(items, { showUnconfirmed, isFranchise: !!isFranchise });
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

import { useQuery } from '@tanstack/react-query';
import { getPlaceIdsWithActiveCoupons } from '../api/coupons';

// Set of Google place IDs that currently have a usable coupon, for the
// Explore "Coupons Only" filter. Short stale time since owners can add or
// expire coupons at any time.
export function useCouponPlaceIds() {
  return useQuery({
    queryKey: ['couponPlaceIds'],
    queryFn: async () => new Set(await getPlaceIdsWithActiveCoupons()),
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });
}

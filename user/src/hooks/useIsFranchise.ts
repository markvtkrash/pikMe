import { useQuery } from '@tanstack/react-query';
import { isFranchiseChain } from '../api/franchises';

// Whether a restaurant is a known franchise/chain, which decides if
// AI-estimated (unconfirmed) menu items may be shown for it. Falls back to
// false if the lookup fails — the safer side, since "not a chain" only ever
// shows items the restaurant confirmed. Chain membership barely changes, so
// it's cached for an hour per restaurant name.
export function useIsFranchise(restaurantName: string | undefined) {
  return useQuery({
    queryKey: ['isFranchise', restaurantName],
    queryFn: async () => {
      try {
        return await isFranchiseChain(restaurantName!);
      } catch (err) {
        console.error('[useIsFranchise] Lookup failed, treating as non-chain:', err);
        return false;
      }
    },
    enabled: !!restaurantName,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

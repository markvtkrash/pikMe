import { useQuery } from '@tanstack/react-query';
import { isChainRestaurant } from '../api/chainMenu';

// Whether the owner's restaurant is part of a chain. `data` is undefined while
// loading, then true/false. Cached for an hour: a restaurant's chain status
// doesn't change during a session.
export function useIsChainRestaurant(name: string | undefined) {
  return useQuery<boolean>({
    queryKey: ['isChainRestaurant', (name ?? '').trim().toLowerCase()],
    queryFn: () => isChainRestaurant(name as string),
    enabled: !!name?.trim(),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

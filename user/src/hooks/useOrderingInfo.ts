import { useQuery } from '@tanstack/react-query';
import { getOrderingInfo, type OrderingInfo } from '../api/orders';

// Whether this restaurant takes orders right now (the owner's switch, and everything else the server checks). Asked fresh each time the
// restaurant opens: kept for only 15 seconds, not the app's usual 5 minutes, so an owner who turns ordering on or off is seen quickly.
export function useOrderingInfo(placeId: string | undefined) {
  return useQuery<OrderingInfo>({
    queryKey: ['orderingInfo', placeId],
    queryFn: () => getOrderingInfo(placeId as string),
    enabled: !!placeId,
    staleTime: 15 * 1000,
    retry: false,
  });
}

import { useQuery } from '@tanstack/react-query';
import { getMyOrders, type OrderListRow } from '../api/orders';
import { summarizeActiveOrders } from '../utils/orders';

export const ACTIVE_ORDERS_KEY = ['myOrdersBanner'];

// The person's recent orders, for the bar at the top of the app. It looks once when the app opens (and again whenever an order is placed
// or changed on screen), and keeps looking every 20 seconds only while an order is still in progress, so a person with no orders makes no
// repeated calls.
export function useActiveOrders(enabled: boolean) {
  return useQuery<OrderListRow[]>({
    queryKey: ACTIVE_ORDERS_KEY,
    queryFn: () => getMyOrders(10),
    enabled,
    staleTime: 15 * 1000,
    retry: false,
    refetchInterval: (query) => (summarizeActiveOrders(query.state.data) ? 20 * 1000 : false),
  });
}

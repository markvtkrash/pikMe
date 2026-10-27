import { supabase } from './supabase';
import { mapMenuRow } from './menuItems';
import { toOrderableDishes, type Dish, type OrderStatus } from '../utils/orders';

// Customer-facing calls for ordering ahead for pickup (migrations 165, 168, 169). Every price comes from the server; the app only
// sends which dishes and how many.

export interface OrderingInfo {
  available: boolean;
  prepMinutes: number;
  timezone: string | null;
  orderableCount: number;
}

const NOT_AVAILABLE: OrderingInfo = { available: false, prepMinutes: 20, timezone: null, orderableCount: 0 };

// Asked live each time a restaurant opens, so the owner's switch takes effect at once. Any problem means "no ordering here": a failed
// lookup must never put an Order button on a restaurant that cannot take orders.
export async function getOrderingInfo(placeId: string): Promise<OrderingInfo> {
  try {
    const { data, error } = await supabase.rpc('get_ordering_info', { p_place_id: placeId });
    if (error) return NOT_AVAILABLE;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return NOT_AVAILABLE;
    return {
      available: row.ordering_available === true,
      prepMinutes: Number(row.prep_minutes) || 20,
      timezone: typeof row.restaurant_timezone === 'string' ? row.restaurant_timezone : null,
      orderableCount: Number(row.orderable_count) || 0,
    };
  } catch {
    return NOT_AVAILABLE;
  }
}

// EVERY dish a customer can order here (not the ranked "top items for you" list, which leaves some out).
export async function getOrderableDishes(placeId: string, restaurantName: string): Promise<Dish[]> {
  const { data, error } = await supabase.rpc('get_menu_items_for_restaurant', { p_place_id: placeId, p_restaurant_name: restaurantName });
  if (error) throw new Error(error.message);
  return toOrderableDishes((data ?? []).map(mapMenuRow));
}

export interface OrderLine {
  item_id: string;
  name: string;
  unit_price_cents: number;
  quantity: number;
  note: string | null;
}

export interface Order {
  order_id: string;
  status: OrderStatus;
  restaurant_name: string;
  place_id: string;
  customer_name: string | null;
  customer_note: string | null;
  pickup_at: string;
  subtotal_cents: number;
  // a coupon's discount (absent from an older server): total = subtotal - discount + tax
  discount_cents?: number;
  coupon_code?: string | null;
  tax_cents: number;
  total_cents: number;
  refund_status: 'none' | 'pending' | 'succeeded' | 'failed';
  created_at: string;
  items: OrderLine[];
}

export interface OrderListRow {
  order_id: string;
  status: OrderStatus;
  restaurant_name: string;
  place_id: string;
  pickup_at: string;
  total_cents: number;
  refund_status: Order['refund_status'];
  created_at: string;
  item_count: number;
}

export interface NewOrder {
  placeId: string;
  items: { item_id: string; quantity: number; note?: string }[];
  customerName: string;
  // null = as soon as possible
  pickupAtMs: number | null;
  note: string;
  // one per checkout attempt, re-sent on a retry so a double tap cannot make two orders
  key: string;
}

// Throws the server's own message (they are written to be shown: "This restaurant is not taking orders right now").
export async function createPickupOrder(order: NewOrder): Promise<Order> {
  const { data, error } = await supabase.rpc('create_pickup_order', {
    p_place_id: order.placeId,
    p_items: order.items,
    p_customer_name: order.customerName,
    p_pickup_at: order.pickupAtMs === null ? null : new Date(order.pickupAtMs).toISOString(),
    p_note: order.note.trim() === '' ? null : order.note,
    p_idempotency_key: order.key,
  });
  if (error) throw new Error(error.message);
  return data as Order;
}

// A coupon this customer can use on their cart, with the discount it would give (worked out by the server).
export interface OrderCoupon {
  coupon_id: string;
  coupon_code: string;
  coupon_type: 'item_percent' | 'item_fixed' | 'generic_percent' | 'generic_fixed';
  discount_value: number;
  menu_item_id: string | null;
  discount_cents: number;
}

// Never throws: a coupon list that cannot be loaded just means no coupon is offered, and the order can still be placed.
export async function getOrderCoupons(placeId: string, items: NewOrder['items']): Promise<OrderCoupon[]> {
  const { data, error } = await supabase.rpc('get_order_coupons', { p_place_id: placeId, p_items: items });
  if (error) return [];
  return (data ?? []) as OrderCoupon[];
}

// Puts a coupon on the customer's own unpaid order, or takes it off (null). Throws the server's message.
export async function applyOrderCoupon(orderId: string, couponId: string | null): Promise<Order> {
  const { data, error } = await supabase.rpc('apply_order_coupon', { p_order_id: orderId, p_coupon_id: couponId });
  if (error) throw new Error(error.message);
  return data as Order;
}

export async function getMyOrder(orderId: string): Promise<Order | null> {
  const { data, error } = await supabase.rpc('get_my_order', { p_order_id: orderId });
  if (error) throw new Error(error.message);
  return (data as Order | null) ?? null;
}

export async function getMyOrders(limit = 20): Promise<OrderListRow[]> {
  const { data, error } = await supabase.rpc('get_my_orders', { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderListRow[];
}

export type CancelResult = 'ok' | 'wrong_state' | 'not_found';

// The text of an error from an edge function (supabase-js hides the server's message inside the error).
export async function functionErrorMessage(error: any, fallback: string): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch {
    // the body was not readable: use the fallback
  }
  return fallback;
}

// Cancelling goes through a server function: when the order was already paid, the refund is asked of Stripe there.
export async function cancelMyOrder(orderId: string): Promise<CancelResult> {
  const { data, error } = await supabase.functions.invoke('customer-cancel-order', { body: { orderId } });
  if (error) throw new Error(await functionErrorMessage(error, 'The order could not be cancelled'));
  return (data?.result ?? 'not_found') as CancelResult;
}

// The address of Stripe's secure payment page for this order. Card details are typed there, never in this app.
export async function startPayment(orderId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('create-order-checkout', { body: { orderId } });
  if (error) throw new Error(await functionErrorMessage(error, 'Payment could not be started'));
  if (!data?.url || typeof data.url !== 'string') throw new Error('Payment could not be started');
  return data.url;
}

// TESTING ONLY: marks the customer's own unpaid order as paid, and only while the admin setting orderingTestMode is on.
export async function testMarkPaid(orderId: string): Promise<CancelResult> {
  const { data, error } = await supabase.rpc('test_mark_my_order_paid', { p_order_id: orderId });
  if (error) throw new Error(error.message);
  return data as CancelResult;
}

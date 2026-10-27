// Pure helpers for ordering ahead for pickup (customer side): money, the cart, pickup times, and how an order's status reads.
// The server (migrations 165, 168) decides everything that matters (prices, limits, the pickup window); these keep the screens honest
// about it, so most mistakes are caught before a request is made.

import type { MenuItem } from '../types';

// ── Money ───────────────────────────────────────────────────────────────────
export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

// ── What can be ordered ─────────────────────────────────────────────────────
export interface Dish {
  itemId: string;
  name: string;
  priceCents: number;
}

// A dish a customer can order: confirmed, with a price. (The server also leaves out anything sold out.)
export function toOrderableDishes(items: MenuItem[]): Dish[] {
  return items
    .filter((i) => i.isVerified && typeof i.priceCents === 'number' && i.priceCents > 0)
    .map((i) => ({ itemId: i.itemId, name: i.name, priceCents: i.priceCents as number }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── The cart ────────────────────────────────────────────────────────────────
export const MAX_QTY_PER_DISH = 20;   // the server's setting orderingMaxItemQuantity decides; this only stops the + button early

export interface CartLine extends Dish {
  quantity: number;
}

export interface Cart {
  placeId: string | null;
  restaurantName: string;
  lines: CartLine[];
}

export const EMPTY_CART: Cart = { placeId: null, restaurantName: '', lines: [] };

export function cartCount(cart: Cart): number {
  return cart.lines.reduce((n, l) => n + l.quantity, 0);
}

export function cartSubtotalCents(cart: Cart): number {
  return cart.lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
}

export function quantityOf(cart: Cart, itemId: string): number {
  return cart.lines.find((l) => l.itemId === itemId)?.quantity ?? 0;
}

// Sets one dish's quantity (0 removes it). Starting a cart at a restaurant puts the dish in an otherwise empty cart; a cart for a
// DIFFERENT restaurant is left alone and reported, so the screen can ask before throwing it away.
export function setQuantity(
  cart: Cart,
  place: { placeId: string; restaurantName: string },
  dish: Dish,
  quantity: number,
  max: number = MAX_QTY_PER_DISH
): { cart: Cart; result: 'ok' | 'other_restaurant' } {
  if (cart.placeId && cart.placeId !== place.placeId && cart.lines.length > 0) {
    return { cart, result: 'other_restaurant' };
  }
  const q = Math.max(0, Math.min(max, Math.floor(Number.isFinite(quantity) ? quantity : 0)));
  const others = cart.lines.filter((l) => l.itemId !== dish.itemId);
  const lines = q === 0 ? others : [...others, { ...dish, quantity: q }];
  // keep the lines in the order the dishes were first added
  const order = new Map(cart.lines.map((l, i) => [l.itemId, i]));
  lines.sort((a, b) => (order.get(a.itemId) ?? 1e9) - (order.get(b.itemId) ?? 1e9));
  if (lines.length === 0) return { cart: EMPTY_CART, result: 'ok' };
  return { cart: { placeId: place.placeId, restaurantName: place.restaurantName, lines }, result: 'ok' };
}

// The cart's lines in the shape create_pickup_order takes. Prices are NOT sent: the server prices every dish itself.
export function cartToOrderItems(cart: Cart, notes: Record<string, string> = {}): { item_id: string; quantity: number; note?: string }[] {
  return cart.lines.map((l) => {
    const note = (notes[l.itemId] ?? '').trim();
    return note ? { item_id: l.itemId, quantity: l.quantity, note } : { item_id: l.itemId, quantity: l.quantity };
  });
}

// Keeps only the dishes still on sale at the current prices (a dish may have gone, or its price changed since it was added).
export function reconcileCart(cart: Cart, current: Dish[]): { cart: Cart; removed: string[]; repriced: string[] } {
  const byId = new Map(current.map((d) => [d.itemId, d]));
  const removed: string[] = [];
  const repriced: string[] = [];
  const lines: CartLine[] = [];
  for (const l of cart.lines) {
    const now = byId.get(l.itemId);
    if (!now) {
      removed.push(l.name);
      continue;
    }
    if (now.priceCents !== l.priceCents) repriced.push(now.name);
    lines.push({ ...l, name: now.name, priceCents: now.priceCents });
  }
  return { cart: lines.length === 0 ? EMPTY_CART : { ...cart, lines }, removed, repriced };
}

// ── Pickup times ────────────────────────────────────────────────────────────
export const SLOT_MINUTES = 15;
const MAX_SLOTS = 64;

// Seconds since local midnight in a timezone (the restaurant's), by the given clock.
export function secondsSinceLocalMidnight(nowMs: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date(nowMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return get('hour') * 3600 + get('minute') * 60 + get('second');
  } catch {
    return 0;
  }
}

// The moments a customer can pick from: every 15 minutes, from the first one at least the prep time away until the restaurant's day
// ends (its next local midnight). On the two days a year the clocks change, the day is an hour longer or shorter and this can be an hour
// off at the very end; the server's own check is the final word.
export function pickupSlots(nowMs: number, prepMinutes: number, timeZone: string): number[] {
  const stepMs = SLOT_MINUTES * 60000;
  const dayEndMs = nowMs + (86400 - secondsSinceLocalMidnight(nowMs, timeZone)) * 1000;
  const earliest = nowMs + prepMinutes * 60000;
  const slots: number[] = [];
  for (let t = Math.ceil(earliest / stepMs) * stepMs; t < dayEndMs && slots.length < MAX_SLOTS; t += stepMs) slots.push(t);
  return slots;
}

export function formatSlot(ms: number, timeZone?: string): string {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
  } catch {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

// ── How an order's status reads ─────────────────────────────────────────────
export type OrderStatus = 'pending_payment' | 'placed' | 'accepted' | 'ready' | 'picked_up' | 'cancelled' | 'refunded';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Waiting for payment',
  placed: 'Sent to the restaurant',
  accepted: 'Being prepared',
  ready: 'Ready for pickup',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status as OrderStatus] ?? status;
}

// Finished: the screen stops refreshing.
export function isFinal(status: string): boolean {
  return status === 'picked_up' || status === 'cancelled' || status === 'refunded';
}

// ── The thin "your order" bar at the top of the app ─────────────────────────
// An order that has not been paid is not an order yet: the restaurant has not seen it and it is cancelled after 30 minutes. So it is left
// out of the bar and out of the My orders list; the person finds it again by ordering from that restaurant, not as a placed order.
export interface BannerOrder {
  order_id: string;
  status: string;
  restaurant_name: string;
  created_at: string;
}

// Placed: paid, so the restaurant has it (whatever has happened to it since).
export function isPlacedOrder(order: Pick<BannerOrder, 'status'>): boolean {
  return order.status !== 'pending_payment';
}

// Placed and not finished.
export function isActiveOrder(order: Pick<BannerOrder, 'status'>): boolean {
  return isPlacedOrder(order) && !isFinal(order.status) && order.status in STATUS_LABEL;
}

// The number of orders in progress, or null when there are none (the bar is then hidden).
export function summarizeActiveOrders(orders: BannerOrder[] | null | undefined): { count: number } | null {
  const count = (orders ?? []).filter(isActiveOrder).length;
  return count === 0 ? null : { count };
}

// The customer can cancel before paying, or after paying while the restaurant has not accepted (migration 168).
export function canCancel(status: string): boolean {
  return status === 'pending_payment' || status === 'placed';
}

// A plain sentence about money coming back, so "cancelled" is never read as "and you were made whole" before that is true.
export function refundNote(status: string, refundStatus: string | null | undefined): string | null {
  if (refundStatus === 'succeeded') return 'Your money has been refunded.';
  if (refundStatus === 'pending') return 'Your refund is on its way.';
  if (refundStatus === 'failed') return 'The refund did not go through. We are looking into it.';
  if (status === 'cancelled' || status === 'refunded') return null;
  return null;
}

export function newIdempotencyKey(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

// What a coupon gives, in a few words: "10% off your order", "$2 off your order", "20% off Burger", "$2 off Burger".
// An item coupon takes the discount off one of that dish. itemName is the dish's name when the cart has it.
export function couponTitle(coupon: { coupon_type: string; discount_value: number; menu_item_id?: string | null }, itemName?: string): string {
  const percent = coupon.coupon_type.endsWith('percent');
  const value = Number(coupon.discount_value);
  const amount = percent ? `${Number.isInteger(value) ? value : value.toFixed(1)}%` : formatCents(Math.round(value * 100));
  const what = coupon.coupon_type.startsWith('item') ? itemName ?? 'one dish' : 'your order';
  return `${amount} off ${what}`;
}

// The fine print for an item coupon: it takes the discount off ONE of that dish, however many are in the order. Null for a coupon on the
// whole order, which needs none.
export function couponScopeNote(coupon: { coupon_type: string }, itemName?: string): string | null {
  if (!coupon.coupon_type.startsWith('item')) return null;
  return `Limit of 1 coupon per item per order (applies to one ${itemName ?? 'dish'}).`;
}

// The total to pay: the dishes less the coupon's discount, never below zero.
export function totalAfterDiscount(subtotalCents: number, discountCents: number): number {
  return Math.max(0, subtotalCents - Math.max(0, discountCents));
}

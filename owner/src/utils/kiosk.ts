// Pure helpers for the staff order screen (the "kiosk", opened from a secret link) and the owner's Kiosk Access page.
// The database side is migration 166; the order flow is placed -> accepted -> ready -> picked up, with a reject for a paid order.

export const KIOSK_POLL_MS = 9000;
export const KIOSK_TOKEN_RE = /^k_[0-9a-f]{64}$/;

export type KioskStatus = 'placed' | 'accepted' | 'ready';
export type KioskAction = 'accept' | 'ready' | 'completed' | 'reject';

export interface KioskItem {
  name: string;
  quantity: number;
  note: string | null;
  unit_price_cents: number;
}

export interface KioskOrder {
  id: string;
  status: KioskStatus;
  pickup_at: string;
  created_at: string;
  customer_name: string | null;
  customer_note: string | null;
  total_cents: number;
  items: KioskItem[];
}

// What kiosk_get_orders returns (server_time lets the screen judge "late" and "ended" by the server's clock, not the tablet's).
export interface KioskData {
  restaurant_name: string;
  expires_at: string;
  server_time: string;
  orders: KioskOrder[];
}

export function isValidKioskToken(token: unknown): token is string {
  return typeof token === 'string' && KIOSK_TOKEN_RE.test(token);
}

export function buildKioskUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/kiosk/${token}`;
}

export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// "in 12 min" / "now" / "5 min late", judged by the given clock. late is true only for a pickup time already past.
export function pickupLabel(iso: string, nowMs: number): { clock: string; relative: string; late: boolean } {
  const pickupMs = new Date(iso).getTime();
  if (Number.isNaN(pickupMs)) return { clock: '', relative: '', late: false };
  const diff = Math.round((pickupMs - nowMs) / 60000);
  let relative: string;
  if (diff >= 60) {
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    relative = m === 0 ? `in ${h} h` : `in ${h} h ${m} min`;
  } else if (diff > 1) {
    relative = `in ${diff} min`;
  } else if (diff >= -1) {
    relative = 'now';
  } else {
    relative = `${-diff} min late`;
  }
  return { clock: formatClock(iso), relative, late: diff < -1 };
}

export function groupOrders(orders: KioskOrder[]): Record<KioskStatus, KioskOrder[]> {
  const groups: Record<KioskStatus, KioskOrder[]> = { placed: [], accepted: [], ready: [] };
  for (const o of orders) {
    if (groups[o.status]) groups[o.status].push(o);
  }
  return groups;
}

// Ids of orders that are new since the last look: placed, and not seen before. The very first look (null) announces nothing.
export function newOrderIds(previousIds: Set<string> | null, orders: KioskOrder[]): string[] {
  if (previousIds === null) return [];
  return orders.filter((o) => o.status === 'placed' && !previousIds.has(o.id)).map((o) => o.id);
}

// The server answers a bad, replaced or ended link with one message.
export function isEndedError(message: string | undefined | null): boolean {
  return typeof message === 'string' && message.includes('expired or is not valid');
}

export function clockSkewMs(serverTimeIso: string, clientNowMs: number): number {
  const server = new Date(serverTimeIso).getTime();
  return Number.isNaN(server) ? 0 : server - clientNowMs;
}

// True once the link's end has passed, by the server's clock (the tablet's own clock may be off).
export function hasEnded(expiresIso: string, clientNowMs: number, skewMs: number): boolean {
  const end = new Date(expiresIso).getTime();
  return Number.isNaN(end) ? false : clientNowMs + skewMs >= end;
}

export interface KioskButton {
  action: KioskAction;
  label: string;
  tone: 'primary' | 'danger';
}

export const BUTTONS_BY_STATUS: Record<KioskStatus, KioskButton[]> = {
  placed: [
    { action: 'accept', label: 'Accept', tone: 'primary' },
    { action: 'reject', label: 'Reject', tone: 'danger' },
  ],
  accepted: [{ action: 'ready', label: 'Ready for pickup', tone: 'primary' }],
  ready: [{ action: 'completed', label: 'Picked up', tone: 'primary' }],
};

// The question asked before a button moves an order on, so a stray tap cannot change an order. The name is the customer's, when there is one.
export function confirmFor(action: KioskAction, customerName: string | null | undefined): { title: string; message: string; confirmText: string; destructive: boolean } {
  const who = (customerName ?? '').trim() || 'The customer';
  switch (action) {
    case 'accept':
      return { title: 'Accept this order?', message: `${who}'s order will be marked as being prepared.`, confirmText: 'Accept', destructive: false };
    case 'ready':
      return { title: 'Ready for pickup?', message: `${who} will see that the order is ready.`, confirmText: 'Ready for pickup', destructive: false };
    case 'completed':
      return { title: 'Picked up?', message: `Confirm that ${who} has collected the order.`, confirmText: 'Picked up', destructive: false };
    case 'reject':
      return { title: 'Reject this order?', message: `${who} will be refunded. This cannot be undone.`, confirmText: 'Reject order', destructive: true };
  }
}

export const STATUS_TITLES: Record<KioskStatus, string> = {
  placed: 'New',
  accepted: 'Preparing',
  ready: 'Ready for pickup',
};

// ── The owner's choice of how long a new link lasts ─────────────────────────
export type ExpiryChoiceKey = 'tonight' | 'week' | 'month';

export const EXPIRY_CHOICES: { key: ExpiryChoiceKey; label: string; days: number | null }[] = [
  { key: 'tonight', label: 'Tonight (midnight)', days: null },
  { key: 'week', label: '7 days', days: 7 },
  { key: 'month', label: '30 days', days: 30 },
];

// null = let the server use the restaurant's local midnight; otherwise an end time that many days from now.
export function expiryFor(choice: ExpiryChoiceKey, nowMs: number): string | null {
  const days = EXPIRY_CHOICES.find((c) => c.key === choice)?.days ?? null;
  return days === null ? null : new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();
}

export function describeLinkEnd(expiresIso: string, nowMs: number): string {
  const end = new Date(expiresIso);
  if (Number.isNaN(end.getTime())) return '';
  const when = end.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return end.getTime() <= nowMs ? `Ended ${when}` : `Ends ${when}`;
}

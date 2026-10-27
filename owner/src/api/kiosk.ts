import { supabase } from './supabase';
import { functionErrorMessage } from './payments';
import type { KioskAction, KioskData } from '../utils/kiosk';

// The staff screen has no login: the link's secret token is the credential, and every call below goes to a function that checks it
// (migration 166). A bad, replaced or ended link comes back as an error whose message isEndedError() recognises.
const ACTION_FUNCTION: Record<Exclude<KioskAction, 'reject'>, string> = {
  accept: 'kiosk_accept_order',
  ready: 'kiosk_mark_order_ready',
  completed: 'kiosk_mark_order_completed',
};

export type KioskResult = 'ok' | 'wrong_state' | 'not_found';

export async function getKioskOrders(token: string): Promise<KioskData> {
  const { data, error } = await supabase.rpc('kiosk_get_orders', { p_kiosk_token: token });
  if (error) throw new Error(error.message);
  return data as KioskData;
}

// 'wrong_state' means someone (the other tablet, or a double tap) already moved the order: refresh and carry on.
// Rejecting goes through a server function instead, because a rejected order that was paid must be refunded and only the server can
// ask Stripe for that. The other actions go straight to the database.
export async function runKioskAction(action: KioskAction, token: string, orderId: string): Promise<KioskResult> {
  if (action === 'reject') {
    const { data, error } = await supabase.functions.invoke('kiosk-order-action', { body: { token, orderId, action: 'reject' } });
    if (error) throw new Error(await functionErrorMessage(error, 'The order could not be rejected'));
    return (data?.result ?? 'not_found') as KioskResult;
  }
  const { data, error } = await supabase.rpc(ACTION_FUNCTION[action], { p_kiosk_token: token, p_order_id: orderId });
  if (error) throw new Error(error.message);
  return data as KioskResult;
}

// ── The owner's side (needs the owner's login) ──────────────────────────────
export interface KioskLink {
  token: string;
  expiresAt: string;
  expired: boolean;
}

function firstRow<T>(data: T | T[] | null | undefined): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

// The current link, or null when none was ever made. A pure read: it never changes the link.
export async function getKioskLink(restaurantId: string): Promise<KioskLink | null> {
  const { data, error } = await supabase.rpc('owner_get_kiosk_link', { p_restaurant_id: restaurantId });
  if (error) throw new Error(error.message);
  const row = firstRow<{ link_token: string; link_expires_at: string; link_expired: boolean }>(data);
  return row ? { token: row.link_token, expiresAt: row.link_expires_at, expired: row.link_expired } : null;
}

// A new link; the old one stops working at once. expiresAt null = tonight at the restaurant's local midnight.
export async function regenerateKioskLink(restaurantId: string, expiresAt: string | null): Promise<KioskLink> {
  const { data, error } = await supabase.rpc('owner_regenerate_kiosk_token', {
    p_restaurant_id: restaurantId,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);
  const row = firstRow<{ link_token: string; link_expires_at: string }>(data);
  if (!row) throw new Error('The link could not be created');
  return { token: row.link_token, expiresAt: row.link_expires_at, expired: false };
}

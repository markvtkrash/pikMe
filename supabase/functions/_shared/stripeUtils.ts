// Pure helpers for the Stripe parts of ordering (no network, no Deno-only code, so they can be unit tested).
// The money flow: a customer pays on Stripe's own hosted page, as a DIRECT charge on the restaurant's own Stripe account.

// ── Form encoding (Stripe's API takes form fields, with brackets for nesting) ─
export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

function flatten(prefix: string, value: FormValue, out: [string, string][]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(`${prefix}[${i}]`, v, out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(prefix ? `${prefix}[${k}]` : k, v, out);
  } else {
    out.push([prefix, String(value)]);
  }
}

export function encodeForm(params: Record<string, FormValue>): string {
  const pairs: [string, string][] = [];
  flatten('', params, pairs);
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

// ── The Checkout page for one order ─────────────────────────────────────────
export interface PayableOrder {
  id: string;
  status: string;
  currency: string;
  subtotal_cents: number;
  discount_cents?: number;   // a coupon's discount; the total is subtotal - discount + tax
  tax_cents: number;
  total_cents: number;
  restaurant_name: string;
  items: { name: string; unit_price_cents: number; quantity: number }[];
}

// Stripe will not make a Checkout page that lasts under 30 minutes; one minute more keeps clear of that edge. It lines up with the
// 30 minutes after which an unpaid order is cancelled.
export const CHECKOUT_LIFETIME_SECONDS = 31 * 60;

const NAME_LIMIT = 200;

// The form fields that make the Checkout page. The amounts come from the order's own saved lines, which the server priced; a total that
// does not equal the lines is refused rather than charged.
export function checkoutSessionParams(
  order: PayableOrder,
  urls: { success: string; cancel: string },
  nowMs: number,
  // Stripe's own coupon for the order's discount, made by the caller (amount_off = the order's discount). Needed exactly when there is one.
  stripeCouponId?: string
): Record<string, FormValue> {
  if (!order.items.length) throw new Error('The order has no dishes');
  const discount = order.discount_cents ?? 0;
  const sum = order.items.reduce((n, i) => n + i.unit_price_cents * i.quantity, 0);
  if (sum !== order.subtotal_cents || order.subtotal_cents - discount + order.tax_cents !== order.total_cents) {
    throw new Error('The order total does not match its dishes');
  }
  if (order.tax_cents !== 0) throw new Error('Tax is not supported yet');
  if (discount < 0 || discount > order.subtotal_cents) throw new Error('The order discount is not valid');
  if (discount > 0 && !stripeCouponId) throw new Error('The order has a discount but no coupon was made for it');
  return {
    mode: 'payment',
    client_reference_id: order.id,
    success_url: urls.success,
    cancel_url: urls.cancel,
    expires_at: Math.floor(nowMs / 1000) + CHECKOUT_LIFETIME_SECONDS,
    line_items: order.items.map((i) => ({
      quantity: i.quantity,
      price_data: {
        currency: order.currency.toLowerCase(),
        unit_amount: i.unit_price_cents,
        product_data: { name: (i.name || 'Item').slice(0, NAME_LIMIT) },
      },
    })),
    ...(discount > 0 && stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
    metadata: { order_id: order.id },
    payment_intent_data: { metadata: { order_id: order.id }, description: `Pickup order from ${order.restaurant_name}`.slice(0, 300) },
  };
}

// ── Reading what Stripe sends ───────────────────────────────────────────────
export interface CheckoutSessionLike {
  id?: string;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
  payment_intent?: string | { id?: string } | null;
}

export function paymentIntentIdOf(session: CheckoutSessionLike): string | null {
  const pi = session.payment_intent;
  if (typeof pi === 'string' && pi) return pi;
  if (pi && typeof pi === 'object' && typeof pi.id === 'string') return pi.id;
  return null;
}

// A paid Checkout page must be for THIS order and for exactly what was owed, before the order is marked paid.
export function sessionMatchesOrder(
  session: CheckoutSessionLike,
  order: { id: string; total_cents: number; currency: string }
): { ok: true } | { ok: false; reason: string } {
  if (session.payment_status !== 'paid') return { ok: false, reason: 'the payment is not complete' };
  if (session.metadata?.order_id !== order.id) return { ok: false, reason: 'the page is for a different order' };
  if (session.amount_total !== order.total_cents) return { ok: false, reason: 'the amount paid is not the order total' };
  if ((session.currency ?? '').toLowerCase() !== order.currency.toLowerCase()) return { ok: false, reason: 'the currency is not the order\'s' };
  return { ok: true };
}

// The same check for a PaymentIntent (the payment itself), for when the payment event is the one received.
export interface PaymentIntentLike {
  id?: string;
  status?: string;
  amount_received?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

export function paymentIntentMatchesOrder(
  intent: PaymentIntentLike,
  order: { id: string; total_cents: number; currency: string }
): { ok: true } | { ok: false; reason: string } {
  if (intent.status !== 'succeeded') return { ok: false, reason: 'the payment is not complete' };
  if (intent.metadata?.order_id !== order.id) return { ok: false, reason: 'the payment is for a different order' };
  if (intent.amount_received !== order.total_cents) return { ok: false, reason: 'the amount paid is not the order total' };
  if ((intent.currency ?? '').toLowerCase() !== order.currency.toLowerCase()) return { ok: false, reason: 'the currency is not the order\'s' };
  return { ok: true };
}

export function interpretAccount(account: { charges_enabled?: boolean; payouts_enabled?: boolean; details_submitted?: boolean }): {
  chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean;
} {
  return {
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
  };
}

// ── Connected accounts, made with Stripe's Accounts v2 API ──────────────────
// New Connect platforms must use Accounts v2 (the older POST /v1/accounts is refused). These settings give the same arrangement as a
// "Standard" account: the restaurant is the merchant and has the full Stripe Dashboard, Stripe collects its card fees from the
// restaurant (not from pikMe), and Stripe, not pikMe, carries the risk of a negative balance. Stripe collects the identity and bank
// details itself, on its own pages.
export function connectedAccountBody(input: { email?: string | null; restaurantName: string; restaurantId: string }): Record<string, unknown> {
  return {
    contact_email: input.email || undefined,
    display_name: input.restaurantName.slice(0, 100) || 'Restaurant',
    dashboard: 'full',
    identity: { country: 'us' },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
    defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
    metadata: { restaurant_id: input.restaurantId },
    include: ['configuration.merchant', 'identity', 'defaults', 'requirements'],
  };
}

// The page the owner finishes on: Stripe's own onboarding. The account has only the merchant part, so Stripe collects what that needs.
// (Stripe's reply lists `configurations`, but it is not accepted in the request: it was refused as an "unknown field".)
export function accountLinkBody(input: { accountId: string; returnUrl: string; refreshUrl: string }): Record<string, unknown> {
  return {
    account: input.accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: { return_url: input.returnUrl, refresh_url: input.refreshUrl },
    },
  };
}

// What a v2 account says about itself. Card payments 'active' means Stripe has approved it to charge cards; 'pending' means the details
// were sent and are being checked; 'restricted' means something is still needed.
export function interpretV2Account(account: {
  configuration?: { merchant?: { capabilities?: { card_payments?: { status?: string }; stripe_balance?: { payouts?: { status?: string } } } } };
}): { chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean } {
  const capabilities = account?.configuration?.merchant?.capabilities;
  const card = capabilities?.card_payments?.status;
  return {
    chargesEnabled: card === 'active',
    payoutsEnabled: capabilities?.stripe_balance?.payouts?.status === 'active',
    detailsSubmitted: card === 'active' || card === 'pending',
  };
}

// ── Webhook signature (Stripe-Signature: t=...,v1=...) ──────────────────────
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signStripePayload(payload: string, timestamp: number, secret: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)));
}

// True only when the header carries a signature made with the secret over exactly this body, and it is recent (default 5 minutes).
export async function verifyStripeSignature(
  payload: string, header: string | null | undefined, secret: string, nowSec: number, toleranceSec = 300
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=');
    if (k?.trim() === 't') timestamp = Number(v);
    else if (k?.trim() === 'v1' && v) signatures.push(v.trim());
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSec - timestamp) > toleranceSec) return false;
  const expected = await signStripePayload(payload, timestamp, secret);
  return signatures.some((s) => equalConstantTime(s, expected));
}

// A refund that Stripe answers with these statuses is finished or on its way; anything else is a failure to record.
export function refundOutcome(status: string | undefined): 'succeeded' | 'pending' | 'failed' {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'pending' || status === 'requires_action') return 'pending';
  return 'failed';
}

// A fake payment (the test button) never reached Stripe, so there is nothing to refund there.
export function isTestPayment(paymentIntentId: string | null | undefined): boolean {
  return typeof paymentIntentId === 'string' && paymentIntentId.startsWith('pi_test_');
}

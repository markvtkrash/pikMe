import { stripeRequest, isTemporary } from './stripe.ts';
import { isTestPayment, refundOutcome } from './stripeUtils.ts';

// Refunds the customer for an order whose refund is 'pending' (the staff rejected it, or the customer cancelled after paying).
// Safe to call again: only a 'pending' refund is acted on, and Stripe is given a fixed idempotency key per order, so two calls cannot
// pay the customer twice. A temporary problem (network, Stripe outage) leaves it 'pending' for the sweep to retry; a refusal from
// Stripe is recorded as 'failed' so an admin can see it.
// deno-lint-ignore no-explicit-any
export async function refundOrder(db: any, secretKey: string | null, orderId: string): Promise<'refunded' | 'pending' | 'failed' | 'nothing'> {
  const { data: order } = await db
    .from('orders').select('id, refund_status, stripe_payment_intent_id, restaurant_id').eq('id', orderId).maybeSingle();
  if (!order || order.refund_status !== 'pending') return 'nothing';

  const record = (status: 'pending' | 'succeeded' | 'failed', detail: string) =>
    db.rpc('set_order_refund_status', { p_order_id: orderId, p_status: status, p_detail: detail });

  const intent: string | null = order.stripe_payment_intent_id;
  if (!intent) {
    await record('failed', 'no payment on record for this order');
    return 'failed';
  }
  if (isTestPayment(intent)) {
    await record('succeeded', 'test payment, no money moved');
    return 'refunded';
  }
  if (!secretKey) return 'pending';   // Stripe is not set up on the server yet: leave it for later

  const { data: account } = await db
    .from('restaurant_payment_accounts').select('stripe_account_id').eq('restaurant_id', order.restaurant_id).maybeSingle();
  if (!account) {
    await record('failed', 'the restaurant has no Stripe account');
    return 'failed';
  }

  try {
    const refund = await stripeRequest(secretKey, 'POST', '/v1/refunds', { payment_intent: intent }, {
      account: account.stripe_account_id,
      idempotencyKey: `refund-${orderId}`,
    });
    const outcome = refundOutcome(refund?.status);
    if (outcome === 'succeeded') {
      await record('succeeded', refund.id ?? '');
      return 'refunded';
    }
    if (outcome === 'pending') return 'pending';   // Stripe's charge.refunded message will finish it
    await record('failed', `Stripe refund status ${refund?.status ?? 'unknown'}`);
    return 'failed';
  } catch (e) {
    if (isTemporary(e)) return 'pending';
    await record('failed', (e instanceof Error ? e.message : 'refund failed').slice(0, 200));
    return 'failed';
  }
}

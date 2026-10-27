import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { serviceClient, stripeKey } from '../_shared/http.ts';
import { refundOrder } from '../_shared/refunds.ts';
import {
  interpretAccount, paymentIntentIdOf, paymentIntentMatchesOrder, sessionMatchesOrder, verifyStripeSignature,
} from '../_shared/stripeUtils.ts';

// Stripe tells us what happened on the restaurants' accounts. This is the ONLY thing that marks an order paid: the customer's browser
// coming back from Stripe proves nothing. The message is checked against Stripe's signature, and against the order itself.
// Set up in Stripe as a Connect webhook ("Events from: Connected accounts") for: payment_intent.succeeded (or checkout.session.completed,
// or both), checkout.session.expired and account.updated if the list offers them, and charge.refunded. If checkout.session.expired is not
// offered, the 30 minute clean-up (process-pending-refunds) cancels unpaid orders instead.
const ok = () => new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

// Marks an order paid, after checking the payment really is for it: on THIS restaurant's Stripe account, for this order, for the
// amount owed. A payment that fails a check is logged and ignored (never marked paid).
async function settlePayment(
  // deno-lint-ignore no-explicit-any
  db: any,
  connectedAccount: string | undefined,
  orderId: string | undefined,
  paymentIntentId: string | null,
  matches: (order: { id: string; total_cents: number; currency: string }) => { ok: true } | { ok: false; reason: string }
): Promise<void> {
  if (!orderId) return;
  const { data: order } = await db.from('orders').select('id, total_cents, currency, restaurant_id').eq('id', orderId).maybeSingle();
  if (!order) return;
  const { data: account } = await db
    .from('restaurant_payment_accounts').select('stripe_account_id').eq('restaurant_id', order.restaurant_id).maybeSingle();
  if (!account || account.stripe_account_id !== connectedAccount) {
    console.warn('[stripe-connect-webhook] payment on an unexpected account for order', orderId);
    return;
  }
  const match = matches(order);
  if (!match.ok) {
    console.warn('[stripe-connect-webhook] payment not accepted for order', orderId, match.reason);
    return;
  }
  const { data: result, error } = await db.rpc('mark_order_paid', { p_order_id: orderId, p_payment_intent_id: paymentIntentId });
  if (error) throw error;
  // paid after the order was cancelled (the customer or the 30 minute clean-up got there first): give the money back
  if (result === 'wrong_state') {
    if (paymentIntentId) await db.from('orders').update({ stripe_payment_intent_id: paymentIntentId }).eq('id', orderId);
    await db.rpc('set_order_refund_status', { p_order_id: orderId, p_status: 'pending', p_detail: 'paid after the order was cancelled' });
    await refundOrder(db, stripeKey(), orderId);
  }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET');
  const payload = await req.text();
  if (!secret || !(await verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret, Math.floor(Date.now() / 1000)))) {
    return new Response('Invalid signature', { status: 400 });
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response('Bad payload', { status: 400 });
  }

  const db = serviceClient();
  try {
    const object = event?.data?.object ?? {};
    const connectedAccount: string | undefined = event?.account;

    // A payment is reported two ways (the Checkout page finishing, and the payment itself succeeding). Either marks the order paid; the
    // second to arrive finds it already paid and changes nothing.
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await settlePayment(db, connectedAccount, object.metadata?.order_id, paymentIntentIdOf(object), (order) => sessionMatchesOrder(object, order));
    } else if (event.type === 'payment_intent.succeeded') {
      await settlePayment(db, connectedAccount, object.metadata?.order_id, typeof object.id === 'string' ? object.id : null, (order) => paymentIntentMatchesOrder(object, order));
    } else if (event.type === 'checkout.session.expired') {
      const orderId = object.metadata?.order_id;
      if (orderId) await db.rpc('mark_order_payment_failed', { p_order_id: orderId });
    } else if (event.type === 'account.updated') {
      const s = interpretAccount(object);
      await db.from('restaurant_payment_accounts').update({
        charges_enabled: s.chargesEnabled, payouts_enabled: s.payoutsEnabled, details_submitted: s.detailsSubmitted, updated_at: new Date().toISOString(),
      }).eq('stripe_account_id', object.id);
    } else if (event.type === 'charge.refunded') {
      const intent = typeof object.payment_intent === 'string' ? object.payment_intent : null;
      if (intent && object.refunded === true) {
        const { data: order } = await db.from('orders').select('id, refund_status').eq('stripe_payment_intent_id', intent).maybeSingle();
        if (order && order.refund_status !== 'succeeded') {
          await db.rpc('set_order_refund_status', { p_order_id: order.id, p_status: 'succeeded', p_detail: 'confirmed by Stripe' });
        }
      }
    }
    return ok();
  } catch (e) {
    // a 500 makes Stripe send the message again later
    console.error('[stripe-connect-webhook]', event?.type, e);
    return new Response('Handler error', { status: 500 });
  }
});

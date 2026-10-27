import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { appUrl, corsHeaders, fail, json, serviceClient, signedInUser, stripeKey } from '../_shared/http.ts';
import { stripeRequest } from '../_shared/stripe.ts';
import { checkoutSessionParams } from '../_shared/stripeUtils.ts';

// The customer taps Pay: this makes Stripe's hosted payment page for THEIR unpaid order and returns its address.
// The page is a direct charge on the restaurant's own Stripe account, for exactly the order's saved total (the server priced it).
//   { orderId } -> { url }
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  try {
    const user = await signedInUser(req);
    if (!user) return fail('Unauthorized', 401);

    const { orderId } = await req.json().catch(() => ({}));
    if (typeof orderId !== 'string' || !orderId) return fail('orderId is required');

    const secret = stripeKey();
    const userUrl = appUrl('USER_APP_URL');
    if (!secret) return fail('Payments are not set up on the server yet: the secret STRIPE_SECRET_KEY is missing', 503);
    if (!userUrl) return fail('Payments are not set up on the server yet: the secret USER_APP_URL is missing', 503);

    const db = serviceClient();
    const { data: order } = await db
      .from('orders')
      .select('id, status, currency, subtotal_cents, discount_cents, coupon_code, tax_cents, total_cents, restaurant_id, restaurant_name, stripe_session_id')
      .eq('id', orderId).eq('customer_id', user.id).maybeSingle();
    if (!order) return fail('That order was not found', 404);
    if (order.status !== 'pending_payment') return fail('This order is already paid or cancelled', 409);

    const { data: account } = await db
      .from('restaurant_payment_accounts').select('stripe_account_id, charges_enabled').eq('restaurant_id', order.restaurant_id).maybeSingle();
    if (!account?.charges_enabled) return fail('This restaurant cannot take card payments yet', 409);

    // a Pay tap for a page that is still open goes back to the same page, not a second one
    if (order.stripe_session_id) {
      try {
        const old = await stripeRequest(secret, 'GET', `/v1/checkout/sessions/${order.stripe_session_id}`, undefined, { account: account.stripe_account_id });
        if (old.status === 'open' && old.url) return json({ url: old.url });
      } catch (_e) {
        // an unreadable old page: make a new one below
      }
    }

    const { data: items } = await db
      .from('order_items').select('name, unit_price_cents, quantity').eq('order_id', order.id).order('id');
    // a coupon's discount reaches Stripe as a one-use coupon for exactly that amount, on the restaurant's own account
    let stripeCouponId: string | undefined;
    if (order.discount_cents > 0) {
      const coupon = await stripeRequest(secret, 'POST', '/v1/coupons', {
        amount_off: order.discount_cents,
        currency: String(order.currency).toLowerCase(),
        duration: 'once',
        max_redemptions: 1,
        name: String(order.coupon_code || 'Coupon').slice(0, 40),
      }, { account: account.stripe_account_id, idempotencyKey: `coupon-${order.id}-${order.discount_cents}` });
      stripeCouponId = coupon.id;
    }
    const params = checkoutSessionParams(
      { ...order, items: items ?? [] },
      { success: `${userUrl}/order/${order.id}?paid=1`, cancel: `${userUrl}/order/${order.id}` },
      Date.now(),
      stripeCouponId
    );
    const session = await stripeRequest(secret, 'POST', '/v1/checkout/sessions', params, {
      account: account.stripe_account_id,
      idempotencyKey: `checkout-${order.id}-${order.stripe_session_id ?? 'first'}`,
    });
    const { error } = await db.from('orders').update({ stripe_session_id: session.id, updated_at: new Date().toISOString() }).eq('id', order.id);
    if (error) throw error;
    return json({ url: session.url });
  } catch (e) {
    console.error('[create-order-checkout]', e);
    return fail(e instanceof Error ? e.message : 'Something went wrong', 500);
  }
});

import {
  CHECKOUT_LIFETIME_SECONDS, accountLinkBody, checkoutSessionParams, connectedAccountBody, encodeForm, interpretAccount, interpretV2Account, isTestPayment,
  paymentIntentIdOf, paymentIntentMatchesOrder, refundOutcome,
  sessionMatchesOrder, signStripePayload, verifyStripeSignature, PayableOrder,
} from '../../../supabase/functions/_shared/stripeUtils';

const ORDER: PayableOrder = {
  id: 'o-1', status: 'pending_payment', currency: 'usd', subtotal_cents: 3000, tax_cents: 0, total_cents: 3000, restaurant_name: 'Diner',
  items: [
    { name: 'Burger', unit_price_cents: 1250, quantity: 2 },
    { name: 'Fries', unit_price_cents: 500, quantity: 1 },
  ],
};
const URLS = { success: 'https://app.example.com/order/o-1?paid=1', cancel: 'https://app.example.com/order/o-1' };
const NOW = Date.parse('2026-10-26T18:00:00Z');

describe('encodeForm', () => {
  it('writes plain fields, skipping empty ones', () => {
    expect(encodeForm({ a: 'x', b: 2, c: true, d: null, e: undefined })).toBe('a=x&b=2&c=true');
  });
  it('writes nested objects and lists the way Stripe reads them', () => {
    const text = decodeURIComponent(encodeForm({ metadata: { order_id: 'o-1' }, line_items: [{ quantity: 2, price_data: { currency: 'usd' } }] }));
    expect(text).toBe('metadata[order_id]=o-1&line_items[0][quantity]=2&line_items[0][price_data][currency]=usd');
  });
  it('escapes what must be escaped', () => {
    expect(encodeForm({ url: 'https://a.com/x?y=1&z=2' })).toBe('url=https%3A%2F%2Fa.com%2Fx%3Fy%3D1%26z%3D2');
    expect(encodeForm({ name: 'Mac & Cheese' })).toBe('name=Mac%20%26%20Cheese');
  });
});

describe('checkoutSessionParams', () => {
  const params = checkoutSessionParams(ORDER, URLS, NOW) as any;

  it('is a one-time payment for this order, with the return addresses', () => {
    expect(params.mode).toBe('payment');
    expect(params.client_reference_id).toBe('o-1');
    expect(params.success_url).toBe(URLS.success);
    expect(params.cancel_url).toBe(URLS.cancel);
    expect(params.metadata).toEqual({ order_id: 'o-1' });
    expect(params.payment_intent_data.metadata).toEqual({ order_id: 'o-1' });
  });

  it('charges exactly the order\'s lines, in cents, in the order\'s currency', () => {
    expect(params.line_items).toEqual([
      { quantity: 2, price_data: { currency: 'usd', unit_amount: 1250, product_data: { name: 'Burger' } } },
      { quantity: 1, price_data: { currency: 'usd', unit_amount: 500, product_data: { name: 'Fries' } } },
    ]);
    const total = params.line_items.reduce((n: number, l: any) => n + l.quantity * l.price_data.unit_amount, 0);
    expect(total).toBe(ORDER.total_cents);
  });

  it('lasts at least the 30 minutes Stripe needs, and lines up with the 30 minute clean-up', () => {
    expect(params.expires_at).toBe(Math.floor(NOW / 1000) + CHECKOUT_LIFETIME_SECONDS);
    expect(CHECKOUT_LIFETIME_SECONDS).toBeGreaterThanOrEqual(30 * 60);
    expect(CHECKOUT_LIFETIME_SECONDS).toBeLessThan(60 * 60);
  });

  it('lowercases the currency and shortens a very long dish name', () => {
    const p = checkoutSessionParams({ ...ORDER, currency: 'USD', items: [{ name: 'x'.repeat(500), unit_price_cents: 3000, quantity: 1 }] }, URLS, NOW) as any;
    expect(p.line_items[0].price_data.currency).toBe('usd');
    expect(p.line_items[0].price_data.product_data.name).toHaveLength(200);
  });

  it('refuses to charge a total that does not match the dishes', () => {
    expect(() => checkoutSessionParams({ ...ORDER, subtotal_cents: 2999, total_cents: 2999 }, URLS, NOW)).toThrow('does not match');
    expect(() => checkoutSessionParams({ ...ORDER, total_cents: 3100 }, URLS, NOW)).toThrow('does not match');
  });

  it('takes a coupon\'s discount off through Stripe\'s own coupon, so Stripe charges exactly the order total', () => {
    const discounted = { ...ORDER, discount_cents: 500, total_cents: 2500 };
    const p = checkoutSessionParams(discounted, URLS, NOW, 'co_123') as any;
    expect(p.discounts).toEqual([{ coupon: 'co_123' }]);
    // the dishes are still charged at full price; the discount comes off in Stripe, ending at the total
    const lines = p.line_items.reduce((n: number, l: any) => n + l.quantity * l.price_data.unit_amount, 0);
    expect(lines - 500).toBe(discounted.total_cents);
    expect((checkoutSessionParams(ORDER, URLS, NOW) as any).discounts).toBeUndefined();
  });

  it('refuses a discount that does not add up, is not valid, or has no Stripe coupon', () => {
    expect(() => checkoutSessionParams({ ...ORDER, discount_cents: 500, total_cents: 3000 }, URLS, NOW, 'co_1')).toThrow('does not match');
    expect(() => checkoutSessionParams({ ...ORDER, discount_cents: 500, total_cents: 2500 }, URLS, NOW)).toThrow('no coupon was made');
    expect(() => checkoutSessionParams({ ...ORDER, discount_cents: 4000, total_cents: -1000 }, URLS, NOW, 'co_1')).toThrow();
  });

  it('refuses an empty order, and tax it does not yet support', () => {
    expect(() => checkoutSessionParams({ ...ORDER, items: [] }, URLS, NOW)).toThrow('no dishes');
    expect(() => checkoutSessionParams({ ...ORDER, tax_cents: 100, total_cents: 3100 }, URLS, NOW)).toThrow('Tax');
  });
});

describe('sessionMatchesOrder', () => {
  const session = { payment_status: 'paid', amount_total: 3000, currency: 'usd', metadata: { order_id: 'o-1' } };
  const order = { id: 'o-1', total_cents: 3000, currency: 'usd' };

  it('accepts a paid page for this order and this amount', () => {
    expect(sessionMatchesOrder(session, order)).toEqual({ ok: true });
    expect(sessionMatchesOrder({ ...session, currency: 'USD' }, order)).toEqual({ ok: true });
  });
  it.each([
    ['not paid yet', { payment_status: 'unpaid' }],
    ['another order', { metadata: { order_id: 'o-2' } }],
    ['no order id', { metadata: {} }],
    ['a different amount', { amount_total: 2999 }],
    ['no amount', { amount_total: null }],
    ['another currency', { currency: 'eur' }],
  ])('refuses %s', (_name, override) => {
    expect(sessionMatchesOrder({ ...session, ...override }, order).ok).toBe(false);
  });
});

describe('paymentIntentMatchesOrder', () => {
  const intent = { id: 'pi_1', status: 'succeeded', amount_received: 3000, currency: 'usd', metadata: { order_id: 'o-1' } };
  const order = { id: 'o-1', total_cents: 3000, currency: 'usd' };

  it('accepts a succeeded payment for this order and this amount', () => {
    expect(paymentIntentMatchesOrder(intent, order)).toEqual({ ok: true });
    expect(paymentIntentMatchesOrder({ ...intent, currency: 'USD' }, order)).toEqual({ ok: true });
  });
  it.each([
    ['not succeeded', { status: 'requires_payment_method' }],
    ['another order', { metadata: { order_id: 'o-2' } }],
    ['no order id', { metadata: {} }],
    ['no metadata', { metadata: null }],
    ['a different amount', { amount_received: 2999 }],
    ['no amount', { amount_received: null }],
    ['another currency', { currency: 'eur' }],
  ])('refuses %s', (_name, override) => {
    expect(paymentIntentMatchesOrder({ ...intent, ...override } as any, order).ok).toBe(false);
  });
});

describe('paymentIntentIdOf', () => {
  it('reads an id given as text or as an object', () => {
    expect(paymentIntentIdOf({ payment_intent: 'pi_1' })).toBe('pi_1');
    expect(paymentIntentIdOf({ payment_intent: { id: 'pi_2' } })).toBe('pi_2');
  });
  it('is null when there is none', () => {
    expect(paymentIntentIdOf({})).toBeNull();
    expect(paymentIntentIdOf({ payment_intent: null })).toBeNull();
    expect(paymentIntentIdOf({ payment_intent: '' })).toBeNull();
  });
});

describe('interpretAccount', () => {
  it('is true only for flags that are exactly true', () => {
    expect(interpretAccount({ charges_enabled: true, payouts_enabled: true, details_submitted: true })).toEqual({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
    expect(interpretAccount({})).toEqual({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
    expect(interpretAccount({ charges_enabled: 'true' as any }).chargesEnabled).toBe(false);
  });
});

describe('connectedAccountBody', () => {
  const body = connectedAccountBody({ email: 'owner@example.com', restaurantName: 'Cactus Grill', restaurantId: 'r-1' }) as any;

  it('makes a merchant account with the full Stripe Dashboard, in the US', () => {
    expect(body.dashboard).toBe('full');
    expect(body.identity).toEqual({ country: 'us' });
    expect(body.configuration).toEqual({ merchant: { capabilities: { card_payments: { requested: true } } } });
    expect(body.display_name).toBe('Cactus Grill');
    expect(body.contact_email).toBe('owner@example.com');
    expect(body.metadata).toEqual({ restaurant_id: 'r-1' });
  });

  it('leaves the fees and the risk of a negative balance with Stripe, never with pikMe', () => {
    expect(body.defaults.responsibilities).toEqual({ fees_collector: 'stripe', losses_collector: 'stripe' });
  });

  it('asks for the parts of the account it reads back', () => {
    expect(body.include).toEqual(expect.arrayContaining(['configuration.merchant', 'requirements']));
  });

  it('copes with no email, and a name that is blank or very long', () => {
    expect((connectedAccountBody({ email: null, restaurantName: 'X', restaurantId: 'r' }) as any).contact_email).toBeUndefined();
    expect((connectedAccountBody({ restaurantName: '', restaurantId: 'r' }) as any).display_name).toBe('Restaurant');
    expect((connectedAccountBody({ restaurantName: 'y'.repeat(300), restaurantId: 'r' }) as any).display_name).toHaveLength(100);
  });
});

describe('accountLinkBody', () => {
  it('asks for Stripe\'s onboarding, with the return addresses', () => {
    expect(accountLinkBody({ accountId: 'acct_1', returnUrl: 'https://o.example.com/r', refreshUrl: 'https://o.example.com/f' })).toEqual({
      account: 'acct_1',
      use_case: {
        type: 'account_onboarding',
        account_onboarding: { return_url: 'https://o.example.com/r', refresh_url: 'https://o.example.com/f' },
      },
    });
  });

  it('does not send "configurations", which Stripe refuses in a request (seen on a real call)', () => {
    const body = accountLinkBody({ accountId: 'acct_1', returnUrl: 'r', refreshUrl: 'f' }) as any;
    expect(body.use_case.account_onboarding).not.toHaveProperty('configurations');
  });
});

describe('interpretV2Account', () => {
  const account = (card?: string, payouts?: string) => ({
    configuration: { merchant: { capabilities: { card_payments: { status: card }, stripe_balance: { payouts: { status: payouts } } } } },
  });

  it('is ready to charge cards only when Stripe says card payments are active', () => {
    expect(interpretV2Account(account('active', 'active'))).toEqual({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
    expect(interpretV2Account(account('active', 'restricted'))).toEqual({ chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true });
  });
  it('has sent its details but is not ready while Stripe is still checking', () => {
    expect(interpretV2Account(account('pending'))).toEqual({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true });
  });
  it('has not finished while something is still needed', () => {
    expect(interpretV2Account(account('restricted'))).toEqual({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
    expect(interpretV2Account(account('unsupported'))).toEqual({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
  });
  it('copes with an account that has no merchant part yet', () => {
    expect(interpretV2Account({})).toEqual({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
    expect(interpretV2Account({ configuration: {} })).toEqual({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
  });
});

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret';
  const payload = '{"id":"evt_1","type":"checkout.session.completed"}';
  const t = 1_790_000_000;

  async function header(overridePayload = payload, ts = t, sec = secret) {
    return `t=${ts},v1=${await signStripePayload(overridePayload, ts, sec)}`;
  }

  it('accepts a signature made with the secret over exactly this body, if recent', async () => {
    expect(await verifyStripeSignature(payload, await header(), secret, t)).toBe(true);
    expect(await verifyStripeSignature(payload, await header(), secret, t + 299)).toBe(true);
  });

  it('accepts when any one of several signatures matches (Stripe sends more than one while a secret is rotating)', async () => {
    const good = await signStripePayload(payload, t, secret);
    expect(await verifyStripeSignature(payload, `t=${t},v1=${'0'.repeat(64)},v1=${good}`, secret, t)).toBe(true);
  });

  it.each([
    ['a body that was changed', async () => verifyStripeSignature(payload + ' ', await header(), secret, t)],
    ['the wrong secret', async () => verifyStripeSignature(payload, await header(payload, t, 'whsec_other'), secret, t)],
    ['an old message', async () => verifyStripeSignature(payload, await header(), secret, t + 301)],
    ['a message from the future', async () => verifyStripeSignature(payload, await header(), secret, t - 301)],
    ['no header', async () => verifyStripeSignature(payload, null, secret, t)],
    ['an empty header', async () => verifyStripeSignature(payload, '', secret, t)],
    ['a header with no signature', async () => verifyStripeSignature(payload, `t=${t}`, secret, t)],
    ['a header with no time', async () => verifyStripeSignature(payload, `v1=${await signStripePayload(payload, t, secret)}`, secret, t)],
    ['a signature of the wrong length', async () => verifyStripeSignature(payload, `t=${t},v1=abc`, secret, t)],
    ['no secret set', async () => verifyStripeSignature(payload, await header(), '', t)],
  ])('refuses %s', async (_name, run) => {
    expect(await run()).toBe(false);
  });

  it('produces the standard HMAC-SHA256 of "<time>.<body>" (checked against a value computed with Node\'s own crypto)', async () => {
    const known = '0d0602f6611bd2252dd4b74b58a4528355a7380639a15e6cc21e3059d56d5b8b';
    expect(await signStripePayload('{}', 1492774577, 'whsec_test')).toBe(known);
    expect(await verifyStripeSignature('{}', `t=1492774577,v1=${known}`, 'whsec_test', 1492774577)).toBe(true);
  });
});

describe('refundOutcome / isTestPayment', () => {
  it('reads what Stripe says about a refund', () => {
    expect(refundOutcome('succeeded')).toBe('succeeded');
    expect(refundOutcome('pending')).toBe('pending');
    expect(refundOutcome('requires_action')).toBe('pending');
    for (const s of ['failed', 'canceled', undefined, 'mystery']) expect(refundOutcome(s as any)).toBe('failed');
  });
  it('knows a fake test payment', () => {
    expect(isTestPayment('pi_test_abc')).toBe(true);
    expect(isTestPayment('pi_3Nabc')).toBe(false);
    expect(isTestPayment(null)).toBe(false);
    expect(isTestPayment(undefined)).toBe(false);
  });
});

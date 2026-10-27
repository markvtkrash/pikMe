import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { appUrl, corsHeaders, fail, json, serviceClient, signedInUser, stripeKey } from '../_shared/http.ts';
import { stripeV2Request } from '../_shared/stripe.ts';
import { accountLinkBody, connectedAccountBody, interpretV2Account } from '../_shared/stripeUtils.ts';

// The owner connects their restaurant to its OWN Stripe account (made with Stripe's Accounts v2 API, set up like a Standard account): pikMe
// creates the account the first time, then sends the owner to Stripe's own pages to enter their business and bank details. pikMe never
// sees those details.
//   { restaurantId, action: 'start' }    -> { url }  where to send the owner (Stripe's onboarding page)
//   { restaurantId, action: 'refresh' }  -> the account's current status, saved to the database
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  try {
    const user = await signedInUser(req);
    if (!user) return fail('Unauthorized', 401);

    const { restaurantId, action = 'start' } = await req.json().catch(() => ({}));
    if (typeof restaurantId !== 'string' || !restaurantId) return fail('restaurantId is required');
    if (action !== 'start' && action !== 'refresh') return fail('action must be start or refresh');

    const secret = stripeKey();
    if (!secret) return fail('Payments are not set up on the server yet: the secret STRIPE_SECRET_KEY is missing', 503);

    const db = serviceClient();
    const { data: restaurant } = await db
      .from('restaurants').select('id, owner_id, name').eq('id', restaurantId).eq('owner_id', user.id).maybeSingle();
    if (!restaurant) return fail('That restaurant is not yours', 403);

    const { data: existing } = await db
      .from('restaurant_payment_accounts').select('stripe_account_id').eq('restaurant_id', restaurant.id).maybeSingle();
    let accountId: string | null = existing?.stripe_account_id ?? null;

    if (action === 'refresh') {
      if (!accountId) return json({ connected: false, canTakePayments: false, payoutsEnabled: false, detailsSubmitted: false });
      const account = await stripeV2Request(secret, 'GET', `/v2/core/accounts/${accountId}`, undefined, { include: ['configuration.merchant', 'requirements'] });
      const s = interpretV2Account(account);
      await db.from('restaurant_payment_accounts').update({
        charges_enabled: s.chargesEnabled, payouts_enabled: s.payoutsEnabled, details_submitted: s.detailsSubmitted, updated_at: new Date().toISOString(),
      }).eq('restaurant_id', restaurant.id);
      // what Stripe itself said, so the owner (and we) can see WHY an account is not ready yet
      const card = account?.configuration?.merchant?.capabilities?.card_payments;
      return json({
        connected: true, canTakePayments: s.chargesEnabled, payoutsEnabled: s.payoutsEnabled, detailsSubmitted: s.detailsSubmitted,
        cardPaymentsStatus: card?.status ?? null,
        cardPaymentsReasons: Array.isArray(card?.status_details) ? card.status_details.map((d: { code?: string }) => d?.code).filter(Boolean) : [],
        payoutsStatus: account?.configuration?.merchant?.capabilities?.stripe_balance?.payouts?.status ?? null,
      });
    }

    const ownerUrl = appUrl('OWNER_APP_URL');
    if (!ownerUrl) return fail('The owner site address is not set on the server yet: the secret OWNER_APP_URL is missing', 503);

    if (!accountId) {
      const { data: owner } = await db.from('restaurant_owners').select('email').eq('id', user.id).maybeSingle();
      const account = await stripeV2Request(secret, 'POST', '/v2/core/accounts', connectedAccountBody({
        email: owner?.email ?? user.email,
        restaurantName: restaurant.name,
        restaurantId: restaurant.id,
      }), undefined, { idempotencyKey: `account-v2-${restaurant.id}` });
      accountId = account.id as string;
      const { error } = await db.from('restaurant_payment_accounts').insert({ restaurant_id: restaurant.id, stripe_account_id: accountId });
      if (error) throw error;
    }

    const link = await stripeV2Request(secret, 'POST', '/v2/core/account_links', accountLinkBody({
      accountId,
      returnUrl: `${ownerUrl}/restaurant/payments?return=1`,
      refreshUrl: `${ownerUrl}/restaurant/payments?refresh=1`,
    }));
    return json({ url: link.url });
  } catch (e) {
    console.error('[restaurant-connect-onboarding]', e);
    return fail(e instanceof Error ? e.message : 'Something went wrong', 500);
  }
});

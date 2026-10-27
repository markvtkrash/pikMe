# Stripe setup for pickup ordering

How the money moves: every restaurant has its **own Stripe account** (made with Stripe's **Accounts v2** API, set up like a "Standard"
account: merchant, full Stripe Dashboard, Stripe collects its fees from the restaurant and carries the negative-balance risk; Stripe now
refuses the older v1 way for new platforms). A customer's payment is a **direct charge** on that account, so the money goes to the restaurant, the restaurant is the merchant and pays Stripe's card fees, and pikMe takes
nothing per order. pikMe never sees card or bank details: customers pay on Stripe's hosted page, and owners enter their business and bank
details on Stripe's onboarding pages.

A *connected account* is a **restaurant's** Stripe account. pikMe creates one per restaurant from the owner's Tools → Get Paid page. You
do not create them by hand, except to test (see step 1).

## 1. In Stripe (start in test mode / a sandbox)

1. Use your main Stripe account as the **platform**. Dashboard → **Connect** → **Get started**. Choose "platform or marketplace" and
   finish the platform profile. (The connected accounts pikMe creates are Standard accounts.)
2. A connected account you made by hand can be used for testing only if it is a **Standard** account. Easier: skip it and let the app make
   one (Tools → Get Paid → Connect with Stripe); Stripe's test mode accepts fake business and bank details (it offers a "Use test data"
   shortcut on its pages).
3. Developers → **API keys** → copy the **Secret key** (`sk_test_...`). No publishable key is needed (payment happens on Stripe's page).
4. Developers → **Webhooks** → **Add endpoint**
   - URL: `https://<your-project-ref>.supabase.co/functions/v1/stripe-connect-webhook`
   - **Events from: Connected accounts** (this is the important one)
   - Events: `checkout.session.completed`, `checkout.session.expired`, `account.updated`, `charge.refunded`
   - Copy the endpoint's **Signing secret** (`whsec_...`).

## 2. Secrets in Supabase (Edge Functions → Secrets, or `supabase secrets set`)

| Secret | Value |
|---|---|
| `STRIPE_SECRET_KEY` | the `sk_test_...` key |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | the `whsec_...` signing secret |
| `USER_APP_URL` | the customer site's address, e.g. `https://app.example.com` (no trailing slash) |
| `OWNER_APP_URL` | the owner site's address |
| `ORDERS_CRON_SECRET` | any long random text (protects the clean-up function) |

## 3. Deploy

```
supabase functions deploy restaurant-connect-onboarding
supabase functions deploy create-order-checkout
supabase functions deploy kiosk-order-action
supabase functions deploy customer-cancel-order
supabase functions deploy stripe-connect-webhook --no-verify-jwt
supabase functions deploy process-pending-refunds --no-verify-jwt
```

The two with `--no-verify-jwt` are called by Stripe and by a timer, which have no login. Both check their own secret.
Run migration `170_order_payments.sql` and its test.

## 4. Try it (test mode)

1. Owner: Tools → **Get Paid** → Connect with Stripe → finish Stripe's pages with test data → back on the page it should show payments
   connected. (If the webhook is set up, `account.updated` also updates it.)
2. Owner: Tools → **Online Ordering**: price a confirmed dish, set the timezone, turn ordering on.
3. Customer: open the restaurant → Order pickup → add a dish → Place order → Stripe's page. Test card **4242 4242 4242 4242**, any future
   date, any CVC. After paying the order moves to "Sent to the restaurant" within seconds.
4. Staff tablet: the order appears; Reject it and the customer is refunded (check the order screen and the Stripe test dashboard).

## 5. Turn it on for real

- In `app_config`, set **`orderingRequirePaymentAccount` = `true`**. From then on a restaurant can take orders only if its Stripe account
  can take payments. (It is `false` by default so nothing changes while you are testing.) Keep `orderingTestMode` = `false`.
- Schedule `process-pending-refunds` every 5 minutes (POST with header `x-orders-secret: <ORDERS_CRON_SECRET>`). It retries refunds that
  could not reach Stripe and cancels orders left unpaid for 30 minutes.
- Live mode: switch to the live secret key, create the same webhook endpoint in live mode, and replace the two secrets.

## Things to know

- A refund comes out of the **restaurant's** Stripe balance. Standard accounts can go briefly negative; Stripe collects it from the
  restaurant's payouts.
- Disputes (chargebacks) belong to the restaurant, handled in their own Stripe dashboard.
- The country is fixed to the US for now (`restaurant-connect-onboarding`).
- Tax is not charged yet; the order total is the sum of the dish prices.

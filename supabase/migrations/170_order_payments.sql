-- Pickup ordering, stage 6 (database part): each restaurant's Stripe account, and the refund state of an order.
--
-- How the money moves: every restaurant has its OWN Stripe account (a "Standard" connected account, created for the owner and onboarded
-- through Stripe's own pages). A customer's payment is a DIRECT charge on that account, so the money goes to the restaurant and the
-- restaurant, not pikMe, is the merchant and pays Stripe's card fees. pikMe takes no cut per order. pikMe never sees card details.
--
--   restaurant_payment_accounts            the restaurant's Stripe account id and whether it can take payments. Server only.
--   _payments_ready(restaurant)            TRUE when the restaurant may take orders as far as payment goes: always, while the setting
--                                          orderingRequirePaymentAccount is 'false' (the default); once it is 'true', only when the
--                                          restaurant's Stripe account can take charges (or orderingTestMode is on, for trying the flow).
--   owner_get_payment_status(restaurant)   owner: is Stripe connected, can it take charges, and is it required.
--   set_order_refund_status(order, status) server only: records that a refund is pending / succeeded / failed.
--   get_ordering_info / owner_set_ordering_enabled   now also need _payments_ready.
--
-- Safe to re-run.

-- ── 1. The restaurant's Stripe account ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.restaurant_payment_accounts (
  restaurant_id     UUID PRIMARY KEY REFERENCES public.restaurants (id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  charges_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  payouts_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  details_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.restaurant_payment_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurant_payment_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.restaurant_payment_accounts TO service_role;

-- ── 2. The switch ───────────────────────────────────────────────────────────
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('orderingRequirePaymentAccount', 'false', 'When true, a restaurant can take online orders only after its Stripe account can take payments (it also cannot switch ordering on before that). Leave false until Stripe is connected and tested; switch it on at launch.', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

CREATE OR REPLACE FUNCTION public._payments_ready(p_restaurant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT COALESCE((SELECT lower(btrim(c.value)) = 'true' FROM public.app_config c WHERE c.key = 'orderingRequirePaymentAccount'), FALSE)
    OR COALESCE((SELECT lower(btrim(c.value)) = 'true' FROM public.app_config c WHERE c.key = 'orderingTestMode'), FALSE)
    OR EXISTS (SELECT 1 FROM public.restaurant_payment_accounts a WHERE a.restaurant_id = p_restaurant_id AND a.charges_enabled);
$$;

REVOKE ALL ON FUNCTION public._payments_ready(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._payments_ready(UUID) TO service_role;

-- ── 3. What the owner sees ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.owner_get_payment_status(p_restaurant_id UUID)
RETURNS TABLE (is_connected BOOLEAN, can_take_payments BOOLEAN, can_receive_payouts BOOLEAN, details_submitted BOOLEAN, payment_required BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT r.owner_id INTO v_owner FROM public.restaurants r WHERE r.id = p_restaurant_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to manage this restaurant';
  END IF;
  RETURN QUERY
    SELECT a.restaurant_id IS NOT NULL,
           COALESCE(a.charges_enabled, FALSE),
           COALESCE(a.payouts_enabled, FALSE),
           COALESCE(a.details_submitted, FALSE),
           COALESCE((SELECT lower(btrim(c.value)) = 'true' FROM public.app_config c WHERE c.key = 'orderingRequirePaymentAccount'), FALSE)
    FROM (SELECT 1) one
    LEFT JOIN public.restaurant_payment_accounts a ON a.restaurant_id = p_restaurant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_get_payment_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_get_payment_status(UUID) TO authenticated;

-- ── 4. Ordering needs payment to be ready (as migration 165, plus _payments_ready) ──
CREATE OR REPLACE FUNCTION public.owner_set_ordering_enabled(p_restaurant_id UUID, p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r public.restaurants%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM public.restaurants r WHERE r.id = p_restaurant_id;
  IF NOT FOUND OR v_r.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to manage this restaurant';
  END IF;

  IF p_enabled IS TRUE THEN
    IF v_r.status <> 'approved' THEN
      RAISE EXCEPTION 'Your restaurant must be approved before you can take orders';
    END IF;
    IF public.is_franchise_chain(v_r.name) THEN
      RAISE EXCEPTION 'Ordering is not available for franchise restaurants';
    END IF;
    IF v_r.timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_r.timezone) THEN
      RAISE EXCEPTION 'Set your restaurant''s timezone before turning on ordering';
    END IF;
    IF public._orderable_item_count(v_r.google_place_id) < 1 THEN
      RAISE EXCEPTION 'Confirm at least one dish and give it a price before turning on ordering';
    END IF;
    IF NOT public._payments_ready(v_r.id) THEN
      RAISE EXCEPTION 'Connect your bank account with Stripe before turning on ordering';
    END IF;
  END IF;

  UPDATE public.restaurants SET ordering_enabled = (p_enabled IS TRUE), updated_at = NOW() WHERE id = p_restaurant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ordering_info(p_place_id TEXT)
RETURNS TABLE (ordering_available BOOLEAN, prep_minutes INTEGER, restaurant_timezone TEXT, orderable_count INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r     public.restaurants%ROWTYPE;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_r FROM public.restaurants r WHERE r.google_place_id = p_place_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 20, NULL::TEXT, 0;
    RETURN;
  END IF;

  v_count := public._orderable_item_count(p_place_id);
  RETURN QUERY SELECT
    (v_r.ordering_enabled
       AND v_r.status = 'approved'
       AND NOT v_r.is_paused
       AND v_r.timezone IS NOT NULL
       AND v_count > 0
       AND NOT public.is_franchise_chain(v_r.name)
       AND public.restaurant_is_listed(p_place_id)
       AND public._payments_ready(v_r.id)),
    v_r.ordering_prep_minutes,
    v_r.timezone,
    v_count;
END;
$$;

-- ── 5. Refunds (server only) ────────────────────────────────────────────────
-- Records what happened to a refund. 'pending' is set by the cancel / reject steps; the refund function then asks Stripe and records
-- 'succeeded' or 'failed'. Returns ok / not_found.
CREATE OR REPLACE FUNCTION public.set_order_refund_status(p_order_id UUID, p_status TEXT, p_detail TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('pending', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'refund status must be pending, succeeded or failed';
  END IF;
  UPDATE public.orders o SET refund_status = p_status, updated_at = NOW() WHERE o.id = p_order_id;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  INSERT INTO public.order_events (order_id, status, actor, detail)
  SELECT o.id, o.status, 'system', LEFT('refund ' || p_status || COALESCE(': ' || p_detail, ''), 300) FROM public.orders o WHERE o.id = p_order_id;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.set_order_refund_status(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_refund_status(UUID, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

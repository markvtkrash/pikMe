-- Test for migration 170: the restaurant's Stripe account record, the payment requirement for ordering, and refund states.
-- Run the WHOLE file in one go; the rules are tried inside a sub-block that is rolled back. Needs migrations 165, 168 and 169.
-- Success: no error, and "ALL 170 TESTS PASSED".

-- Runs one statement that must FAIL with a message matching the pattern; any other outcome stops the test.
CREATE OR REPLACE FUNCTION pg_temp.expect_error(q TEXT, pat TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE q;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE pat THEN
      RAISE EXCEPTION 'wrong error for [%]: got [%], wanted [%]', q, SQLERRM, pat;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected an error but none came: %', q;
END;
$$;

DO $$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-0000000170a1';
  v_other UUID := '00000000-0000-0000-0000-0000000170a2';
  v_c1    UUID := '00000000-0000-0000-0000-0000000170c1';
  v_place CONSTANT TEXT := 'ChIJpay170aaaaaaaaaa';
  v_rest  UUID;
  v_rest2 UUID;
  v_order UUID;
  v_row   RECORD;
BEGIN
  ASSERT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.restaurant_payment_accounts'::regclass), 'the account table has row level security on';
  ASSERT NOT has_table_privilege('anon', 'public.restaurant_payment_accounts', 'SELECT'), 'anon cannot read it';
  ASSERT NOT has_table_privilege('authenticated', 'public.restaurant_payment_accounts', 'SELECT'), 'owners and customers cannot read it directly';
  ASSERT has_table_privilege('service_role', 'public.restaurant_payment_accounts', 'SELECT, INSERT, UPDATE, DELETE'), 'the server can use it';
  ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'orderingRequirePaymentAccount'), 'the requirement setting exists';
  ASSERT NOT has_function_privilege('anon', 'public.owner_get_payment_status(uuid)', 'EXECUTE'), 'anon cannot read the payment status';
  ASSERT has_function_privilege('authenticated', 'public.owner_get_payment_status(uuid)', 'EXECUTE'), 'owners can';
  FOR v_row IN SELECT unnest(ARRAY['public._payments_ready(uuid)', 'public.set_order_refund_status(uuid,text,text)']) AS sig LOOP
    ASSERT NOT has_function_privilege('anon', v_row.sig, 'EXECUTE'), 'anon cannot run ' || v_row.sig;
    ASSERT NOT has_function_privilege('authenticated', v_row.sig, 'EXECUTE'), 'customers cannot run ' || v_row.sig;
    ASSERT has_function_privilege('service_role', v_row.sig, 'EXECUTE'), 'the server can run ' || v_row.sig;
  END LOOP;

  BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
      (v_owner, 'pay-170a1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_other, 'pay-170a2@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_c1, 'pay-170c1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.restaurant_owners (id, business_name, email, is_active) VALUES
      (v_owner, 'Pay Test A', 'pay-170a1@example.com', TRUE), (v_other, 'Pay Test B', 'pay-170a2@example.com', TRUE);
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status, timezone)
    VALUES (v_owner, v_place, 'Pay Test Diner 170', '1 Main St', 'approved', 'America/Chicago') RETURNING id INTO v_rest;
    INSERT INTO public.menu_items (item_id, restaurant_name, name, place_id, is_verified, price_cents)
    VALUES ('test170_a', 'Pay Test Diner 170', 'Burger', v_place, TRUE, 1250);

    -- the requirement is off by default: payment is "ready" for everyone, and nothing changes from before
    UPDATE public.app_config SET value = 'false' WHERE key = 'orderingRequirePaymentAccount';
    UPDATE public.app_config SET value = 'false' WHERE key = 'orderingTestMode';
    ASSERT public._payments_ready(v_rest) IS TRUE, 'with the requirement off, payment is ready';
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
    PERFORM public.owner_set_ordering_enabled(v_rest, TRUE);
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS TRUE, 'ordering is available, as before';

    -- the owner's view of payment
    SELECT * INTO v_row FROM public.owner_get_payment_status(v_rest);
    ASSERT v_row.is_connected IS FALSE AND v_row.can_take_payments IS FALSE AND v_row.payment_required IS FALSE, 'not connected, not required';
    PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
    PERFORM pg_temp.expect_error(format($q$SELECT * FROM public.owner_get_payment_status(%L)$q$, v_rest), '%Not authorized%');
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

    -- the requirement on: no Stripe account, no ordering
    UPDATE public.app_config SET value = 'true' WHERE key = 'orderingRequirePaymentAccount';
    ASSERT public._payments_ready(v_rest) IS FALSE, 'no account: not ready';
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS FALSE, 'ordering is no longer available';
    ASSERT (SELECT payment_required FROM public.owner_get_payment_status(v_rest)) IS TRUE, 'the owner is told it is required';
    PERFORM public.owner_set_ordering_enabled(v_rest, FALSE);
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_set_ordering_enabled(%L, TRUE)$q$, v_rest), '%Connect your bank account with Stripe%');

    -- an account that has not finished onboarding is not enough
    INSERT INTO public.restaurant_payment_accounts (restaurant_id, stripe_account_id, charges_enabled, details_submitted)
    VALUES (v_rest, 'acct_test170', FALSE, TRUE);
    SELECT * INTO v_row FROM public.owner_get_payment_status(v_rest);
    ASSERT v_row.is_connected IS TRUE AND v_row.can_take_payments IS FALSE AND v_row.details_submitted IS TRUE, 'connected, details sent, but cannot take payments yet';
    ASSERT public._payments_ready(v_rest) IS FALSE, 'still not ready';
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_set_ordering_enabled(%L, TRUE)$q$, v_rest), '%Connect your bank account with Stripe%');

    -- an account that can take charges is
    UPDATE public.restaurant_payment_accounts SET charges_enabled = TRUE WHERE restaurant_id = v_rest;
    ASSERT public._payments_ready(v_rest) IS TRUE, 'ready once charges are enabled';
    PERFORM public.owner_set_ordering_enabled(v_rest, TRUE);
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS TRUE, 'ordering is available again';

    -- test mode lets the flow be tried without an account
    UPDATE public.restaurant_payment_accounts SET charges_enabled = FALSE WHERE restaurant_id = v_rest;
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS FALSE, 'not available without charges';
    UPDATE public.app_config SET value = 'true' WHERE key = 'orderingTestMode';
    ASSERT public._payments_ready(v_rest) IS TRUE AND (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS TRUE, 'test mode: available';
    UPDATE public.app_config SET value = 'false' WHERE key = 'orderingTestMode';

    -- one Stripe account belongs to one restaurant
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status)
    VALUES (v_other, 'ChIJpay170bbbbbbbbbb', 'Pay Test Other 170', '2 Main St', 'approved') RETURNING id INTO v_rest2;
    PERFORM pg_temp.expect_error(format($q$INSERT INTO public.restaurant_payment_accounts (restaurant_id, stripe_account_id) VALUES (%L, 'acct_test170')$q$, v_rest2), '%restaurant_payment_accounts%');

    -- refund states
    INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, customer_id, customer_name, status, pickup_at, subtotal_cents, total_cents, stripe_payment_intent_id)
    VALUES (v_rest, v_place, 'Pay Test Diner 170', v_c1, 'Ann', 'cancelled', NOW() + INTERVAL '30 minutes', 1250, 1250, 'pi_test170') RETURNING id INTO v_order;
    ASSERT public.set_order_refund_status(v_order, 'pending') = 'ok', 'pending recorded';
    ASSERT (SELECT refund_status FROM public.orders WHERE id = v_order) = 'pending', 'it is pending';
    ASSERT public.set_order_refund_status(v_order, 'succeeded', 're_123') = 'ok', 'succeeded recorded';
    ASSERT (SELECT refund_status FROM public.orders WHERE id = v_order) = 'succeeded', 'it is succeeded';
    ASSERT EXISTS (SELECT 1 FROM public.order_events WHERE order_id = v_order AND detail = 'refund succeeded: re_123'), 'and the event says so';
    ASSERT public.set_order_refund_status(v_order, 'failed', 'card closed') = 'ok', 'failed recorded';
    ASSERT public.set_order_refund_status('00000000-0000-0000-0000-000000000000', 'pending') = 'not_found', 'an unknown order is not found';
    PERFORM pg_temp.expect_error(format($q$SELECT public.set_order_refund_status(%L, 'paid')$q$, v_order), '%must be pending, succeeded or failed%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.set_order_refund_status(%L, 'none')$q$, v_order), '%must be pending, succeeded or failed%');

    RAISE EXCEPTION 'rollback_test_170';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_170' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 170 TESTS PASSED';
END $$;

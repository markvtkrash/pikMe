-- Test for migration 168: a customer places, sees and cancels a pickup order; the payment's side marks it paid or failed.
-- Run the WHOLE file in one go; the rules are tried inside a sub-block that is rolled back. Needs migrations 165, 166 and 167 (and what
-- they need). Success: no error, and "ALL 168 TESTS PASSED".

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

-- ── Block 1: wiring ─────────────────────────────────────────────────────────
DO $$
DECLARE
  sig TEXT;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'orderingMinimumCents'), 'the minimum order setting exists';
  ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'orderingMaxItemQuantity'), 'the most-of-one-dish setting exists';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'client_idempotency_key'), 'orders has the retry key';

  FOREACH sig IN ARRAY ARRAY[
    'public.create_pickup_order(text,jsonb,text,timestamptz,text,text)', 'public.get_my_order(uuid)', 'public.customer_cancel_order(uuid)'] LOOP
    ASSERT NOT has_function_privilege('anon', sig, 'EXECUTE'), 'anon cannot run ' || sig;
    ASSERT has_function_privilege('authenticated', sig, 'EXECUTE'), 'a signed-in customer can run ' || sig;
  END LOOP;

  FOREACH sig IN ARRAY ARRAY[
    'public.mark_order_paid(uuid,text)', 'public.mark_order_payment_failed(uuid)', 'public.cancel_stale_pending_orders(integer)', 'public._order_summary(uuid)'] LOOP
    ASSERT NOT has_function_privilege('anon', sig, 'EXECUTE'), 'anon cannot run ' || sig;
    ASSERT NOT has_function_privilege('authenticated', sig, 'EXECUTE'), 'customers cannot run ' || sig;
    ASSERT has_function_privilege('service_role', sig, 'EXECUTE'), 'the server can run ' || sig;
  END LOOP;

  RAISE NOTICE 'PASS: block 1 (wiring)';
END $$;


-- ── Block 2: placing, seeing and cancelling orders; the payment's side ──────
DO $$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-0000000168a1';
  v_c1    UUID := '00000000-0000-0000-0000-0000000168c1';
  v_c2    UUID := '00000000-0000-0000-0000-0000000168c2';
  v_place CONSTANT TEXT := 'ChIJord168aaaaaaaaaa';
  v_rest  UUID;
  v_tz    TEXT;
  v_end   TIMESTAMPTZ;
  v_res   JSONB;
  v_o1    UUID;
  v_o2    UUID;
  v_o3    UUID;
  v_items JSONB;
BEGIN
  BEGIN
    -- a timezone whose day does not end within 5 hours, so the "today" rules can be tried at any time of day
    SELECT z INTO v_tz FROM unnest(ARRAY['America/Chicago', 'Asia/Tokyo', 'Europe/London', 'Pacific/Auckland', 'America/Los_Angeles']) z
     WHERE public._next_local_midnight(z) > NOW() + INTERVAL '5 hours' LIMIT 1;
    ASSERT v_tz IS NOT NULL, 'a timezone with room left in its day';
    v_end := public._next_local_midnight(v_tz);

    INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
      (v_owner, 'orders-168a1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_c1, 'orders-168c1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_c2, 'orders-168c2@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.restaurant_owners (id, business_name, email, is_active) VALUES (v_owner, 'Orders Test', 'orders-168a1@example.com', TRUE);
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status, timezone, ordering_enabled, ordering_prep_minutes)
    VALUES (v_owner, v_place, 'Orders Test Diner 168', '1 Main St', 'approved', v_tz, TRUE, 20) RETURNING id INTO v_rest;

    INSERT INTO public.menu_items (item_id, restaurant_name, name, place_id, is_verified, is_out_of_stock, price_cents) VALUES
      ('test168_a', 'Orders Test Diner 168', 'Burger', v_place, TRUE, FALSE, 1250),
      ('test168_b', 'Orders Test Diner 168', 'Fries', v_place, TRUE, FALSE, 500),
      ('test168_s', 'Orders Test Diner 168', 'Sold Out Soup', v_place, TRUE, TRUE, 700),
      ('test168_u', 'Orders Test Diner 168', 'Guessed Salad', v_place, FALSE, FALSE, 600),
      ('test168_n', 'Orders Test Diner 168', 'Unpriced Pie', v_place, TRUE, FALSE, NULL),
      ('test168_c', 'Orders Test Diner 168', 'Cheap Mint', v_place, TRUE, FALSE, 200),
      ('test168_t', 'Orders Test Diner 168', 'Template Dish', NULL, TRUE, FALSE, NULL);

    -- must be signed in
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":1}]'::jsonb, 'Ann')$q$, v_place), '%Sign in%');

    PERFORM set_config('request.jwt.claim.sub', v_c1::text, true);

    -- the order's contents
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[]'::jsonb, 'Ann')$q$, v_place), '%at least one dish%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, NULL, 'Ann')$q$, v_place), '%at least one dish%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '{"item_id":"test168_a"}'::jsonb, 'Ann')$q$, v_place), '%at least one dish%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":1}]'::jsonb, '   ')$q$, v_place), '%name for the order%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":1}]'::jsonb, 'Ann', NULL, %L)$q$, v_place, repeat('x', 301)), '%at most 300%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":0}]'::jsonb, 'Ann')$q$, v_place), '%between 1 and 20%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":21}]'::jsonb, 'Ann')$q$, v_place), '%between 1 and 20%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":1.5}]'::jsonb, 'Ann')$q$, v_place), '%not valid%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a"}]'::jsonb, 'Ann')$q$, v_place), '%not valid%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"quantity":1}]'::jsonb, 'Ann')$q$, v_place), '%not valid%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":1},{"item_id":"test168_a","quantity":2}]'::jsonb, 'Ann')$q$, v_place), '%only once%');

    -- dishes that cannot be ordered
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_nosuch","quantity":1}]'::jsonb, 'Ann')$q$, v_place), '%no longer available%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_s","quantity":5}]'::jsonb, 'Ann')$q$, v_place), '%no longer available%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_u","quantity":5}]'::jsonb, 'Ann')$q$, v_place), '%no longer available%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_n","quantity":5}]'::jsonb, 'Ann')$q$, v_place), '%no longer available%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_t","quantity":5}]'::jsonb, 'Ann')$q$, v_place), '%no longer available%');
    -- a place that is not a pikMe restaurant
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":1}]'::jsonb, 'Ann')$q$, 'ChIJnoplace168xxxxxxx'), '%not taking orders%');

    -- the minimum order ($3.00): one Cheap Mint is $2.00
    UPDATE public.app_config SET value = '300' WHERE key = 'orderingMinimumCents';
    UPDATE public.app_config SET value = '20' WHERE key = 'orderingMaxItemQuantity';
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_c","quantity":1}]'::jsonb, 'Ann')$q$, v_place), '%at least $3.00%');
    UPDATE public.app_config SET value = '150' WHERE key = 'orderingMinimumCents';
    v_res := public.create_pickup_order(v_place, '[{"item_id":"test168_c","quantity":1}]'::jsonb, 'Ann');
    ASSERT (v_res->>'subtotal_cents')::INTEGER = 200, 'with a lower minimum, the $2.00 order goes through';
    UPDATE public.orders SET status = 'cancelled' WHERE id = (v_res->>'order_id')::UUID;   -- out of the way of the unpaid-orders limit below
    UPDATE public.app_config SET value = '300' WHERE key = 'orderingMinimumCents';

    -- ordering off
    UPDATE public.restaurants SET ordering_enabled = FALSE WHERE id = v_rest;
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":1}]'::jsonb, 'Ann')$q$, v_place), '%not taking orders%');
    UPDATE public.restaurants SET ordering_enabled = TRUE WHERE id = v_rest;

    -- the pickup time
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":1}]'::jsonb, 'Ann', NOW() + INTERVAL '10 minutes')$q$, v_place), '%at least 20 minutes%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":1}]'::jsonb, 'Ann', NOW() - INTERVAL '1 hour')$q$, v_place), '%at least 20 minutes%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":1}]'::jsonb, 'Ann', %L)$q$, v_place, v_end), '%before the restaurant''s day ends%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, '[{"item_id":"test168_a","quantity":1}]'::jsonb, 'Ann', %L)$q$, v_place, v_end + INTERVAL '2 hours'), '%before the restaurant''s day ends%');

    -- a good order: priced from the database (the app's own price below is ignored), name trimmed, ASAP pickup
    v_items := '[{"item_id":"test168_a","quantity":2,"price_cents":1,"note":"medium"},{"item_id":"test168_b","quantity":1}]'::jsonb;
    v_res := public.create_pickup_order(v_place, v_items, '  Ann  ', NULL, ' no onions ', 'key-1');
    v_o1 := (v_res->>'order_id')::UUID;
    ASSERT v_res->>'status' = 'pending_payment', 'a new order waits for payment';
    ASSERT (v_res->>'subtotal_cents')::INTEGER = 3000 AND (v_res->>'total_cents')::INTEGER = 3000 AND (v_res->>'tax_cents')::INTEGER = 0,
      '2 x $12.50 + $5.00 = $30.00, from the database prices';
    ASSERT v_res->>'customer_name' = 'Ann' AND v_res->>'customer_note' = 'no onions', 'the name and note are trimmed';
    ASSERT v_res->>'restaurant_name' = 'Orders Test Diner 168' AND v_res->>'refund_status' = 'none', 'the restaurant and refund state';
    ASSERT jsonb_array_length(v_res->'items') = 2, 'two lines';
    ASSERT (SELECT SUM((i->>'unit_price_cents')::INTEGER * (i->>'quantity')::INTEGER) FROM jsonb_array_elements(v_res->'items') i) = 3000, 'the lines add up to the total';
    ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'items') i WHERE i->>'name' = 'Burger' AND i->>'note' = 'medium'), 'the dish note is kept';
    ASSERT (v_res->>'pickup_at')::TIMESTAMPTZ BETWEEN NOW() + INTERVAL '19 minutes' AND NOW() + INTERVAL '21 minutes', 'as soon as possible = now + the prep time';
    ASSERT (SELECT COUNT(*) FROM public.order_events WHERE order_id = v_o1 AND actor = 'customer') = 1, 'one event is recorded';
    ASSERT (SELECT customer_id FROM public.orders WHERE id = v_o1) = v_c1, 'it belongs to the customer';

    -- a later change of price does not change the order
    UPDATE public.menu_items SET price_cents = 9999 WHERE item_id = 'test168_a';
    ASSERT (public.get_my_order(v_o1)->>'total_cents')::INTEGER = 3000, 'the order keeps the price it was made at';
    UPDATE public.menu_items SET price_cents = 1250 WHERE item_id = 'test168_a';

    -- a retry with the same key returns the same order
    v_res := public.create_pickup_order(v_place, v_items, 'Ann', NULL, NULL, 'key-1');
    ASSERT (v_res->>'order_id')::UUID = v_o1, 'a retry gives back the same order';
    ASSERT (SELECT COUNT(*) FROM public.orders WHERE customer_id = v_c1 AND client_idempotency_key = 'key-1') = 1, 'and makes no second one';
    -- another customer may use the same key
    PERFORM set_config('request.jwt.claim.sub', v_c2::text, true);
    v_res := public.create_pickup_order(v_place, v_items, 'Bob', NULL, NULL, 'key-1');
    ASSERT (v_res->>'order_id')::UUID <> v_o1, 'another customer''s order is a different one';
    v_o3 := (v_res->>'order_id')::UUID;
    PERFORM set_config('request.jwt.claim.sub', v_c1::text, true);

    -- a chosen pickup time later today; the last minute of the day is allowed
    v_res := public.create_pickup_order(v_place, v_items, 'Ann', NOW() + INTERVAL '90 minutes', NULL, 'key-2');
    v_o2 := (v_res->>'order_id')::UUID;
    ASSERT (v_res->>'pickup_at')::TIMESTAMPTZ BETWEEN NOW() + INTERVAL '89 minutes' AND NOW() + INTERVAL '91 minutes', 'the chosen time is kept';
    v_res := public.create_pickup_order(v_place, v_items, 'Ann', v_end - INTERVAL '1 minute', NULL, 'key-3');
    ASSERT (v_res->>'order_id') IS NOT NULL, 'one minute before the day ends is fine';

    -- a limit on unpaid orders: c1 now has three waiting (key-1, key-2, key-3), so a fourth is refused
    PERFORM pg_temp.expect_error(format($q$SELECT public.create_pickup_order(%L, %L::jsonb, 'Ann', NULL, NULL, 'key-4')$q$, v_place, v_items::text), '%several unpaid orders%');

    -- seeing your own order, and only yours
    ASSERT public.get_my_order(v_o1) IS NOT NULL, 'a customer sees their order';
    PERFORM set_config('request.jwt.claim.sub', v_c2::text, true);
    ASSERT public.get_my_order(v_o1) IS NULL, 'another customer sees nothing';
    ASSERT public.customer_cancel_order(v_o1) = 'not_found', 'and cannot cancel it';
    PERFORM set_config('request.jwt.claim.sub', v_c1::text, true);

    -- cancelling before payment: no refund involved
    ASSERT public.customer_cancel_order(v_o2) = 'ok', 'cancel an unpaid order';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o2) = 'cancelled' AND (SELECT refund_status FROM public.orders WHERE id = v_o2) = 'none', 'cancelled, no refund';
    ASSERT public.customer_cancel_order(v_o2) = 'wrong_state', 'a second cancel does nothing';
    ASSERT public.customer_cancel_order('00000000-0000-0000-0000-000000000000') = 'not_found', 'an unknown order is not found';

    -- the payment's side
    ASSERT public.mark_order_paid(v_o1, 'pi_test_168') = 'ok', 'payment confirmed';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o1) = 'placed' AND (SELECT stripe_payment_intent_id FROM public.orders WHERE id = v_o1) = 'pi_test_168', 'the order is placed';
    ASSERT (SELECT COUNT(*) FROM public.order_events WHERE order_id = v_o1 AND status = 'placed') = 1, 'one placed event';
    ASSERT public.mark_order_paid(v_o1, 'pi_test_168') = 'ok', 'a repeated webhook is fine';
    ASSERT (SELECT COUNT(*) FROM public.order_events WHERE order_id = v_o1 AND status = 'placed') = 1, 'and adds no second event';
    ASSERT public.mark_order_paid(v_o2, 'pi_late') = 'wrong_state', 'a payment for a cancelled order is flagged (the caller must refund it)';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o2) = 'cancelled', 'and the order stays cancelled';
    ASSERT public.mark_order_paid('00000000-0000-0000-0000-000000000000') = 'not_found', 'an unknown order is not found';
    ASSERT public.mark_order_payment_failed(v_o1) = 'wrong_state', 'a paid order cannot fail';
    ASSERT public.mark_order_payment_failed(v_o2) = 'ok', 'an already cancelled order: nothing to do';

    -- cancelling a PAID order the restaurant has not accepted: allowed, with the refund pending
    ASSERT public.customer_cancel_order(v_o1) = 'ok', 'cancel a placed order';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o1) = 'cancelled' AND (SELECT refund_status FROM public.orders WHERE id = v_o1) = 'pending', 'cancelled, refund pending';

    -- once the restaurant has accepted it, the customer can no longer cancel
    PERFORM set_config('request.jwt.claim.sub', v_c2::text, true);
    ASSERT public.mark_order_paid(v_o3, 'pi_test_168b') = 'ok', 'the second order is paid';
    UPDATE public.orders SET status = 'accepted' WHERE id = v_o3;
    ASSERT public.customer_cancel_order(v_o3) = 'wrong_state', 'an accepted order cannot be cancelled by the customer';

    -- a failed payment cancels the waiting order
    PERFORM set_config('request.jwt.claim.sub', v_c1::text, true);
    UPDATE public.orders SET status = 'pending_payment', refund_status = 'none' WHERE id = v_o2;
    ASSERT public.mark_order_payment_failed(v_o2) = 'ok', 'a failed payment';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o2) = 'cancelled', 'cancels the order';
    ASSERT EXISTS (SELECT 1 FROM public.order_events WHERE order_id = v_o2 AND detail = 'payment failed'), 'and says why';

    -- orders left unpaid for 30 minutes are cancelled; newer, paid and other orders are left alone
    UPDATE public.orders SET status = 'pending_payment' WHERE id = v_o2;
    UPDATE public.orders SET created_at = NOW() - INTERVAL '31 minutes' WHERE id = v_o2;
    ASSERT (SELECT COUNT(*) FROM public.orders WHERE status = 'pending_payment' AND customer_id = v_c1 AND created_at > NOW() - INTERVAL '30 minutes') >= 1, 'there is a recent unpaid order';
    ASSERT public.cancel_stale_pending_orders(30) >= 1, 'the stale one is cancelled';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o2) = 'cancelled', 'it is cancelled';
    ASSERT EXISTS (SELECT 1 FROM public.order_events WHERE order_id = v_o2 AND detail = 'payment not completed in time'), 'with the reason';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o3) = 'accepted', 'a paid order is untouched';
    ASSERT (SELECT COUNT(*) FROM public.orders WHERE status = 'pending_payment' AND customer_id = v_c1 AND created_at > NOW() - INTERVAL '30 minutes') >= 1, 'recent unpaid orders are untouched';

    RAISE EXCEPTION 'rollback_test_168';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_168' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 2 (placing, seeing, cancelling, payment side)';
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL 168 TESTS PASSED'; END $$;

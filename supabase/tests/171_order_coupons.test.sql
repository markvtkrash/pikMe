-- Test for migration 171: a restaurant's coupon applied to a pickup order.
-- Run the WHOLE file in one go; the rules are tried inside a sub-block that is rolled back. Needs migrations 165 to 170 (and what they
-- need). Success: no error, and "ALL 171 TESTS PASSED".

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
  FOREACH sig IN ARRAY ARRAY['orders.coupon_id', 'orders.coupon_code', 'orders.discount_cents', 'orders.coupon_counted'] LOOP
    ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = split_part(sig, '.', 1) AND column_name = split_part(sig, '.', 2)), sig || ' exists';
  END LOOP;

  FOREACH sig IN ARRAY ARRAY['public.get_order_coupons(text,jsonb)', 'public.apply_order_coupon(uuid,uuid)'] LOOP
    ASSERT NOT has_function_privilege('anon', sig, 'EXECUTE'), 'anon cannot run ' || sig;
    ASSERT has_function_privilege('authenticated', sig, 'EXECUTE'), 'a signed-in customer can run ' || sig;
  END LOOP;

  FOREACH sig IN ARRAY ARRAY['public._coupon_discount_cents(uuid,jsonb)', 'public._coupon_usable(uuid,uuid,uuid,uuid)', 'public.mark_order_paid(uuid,text)'] LOOP
    ASSERT NOT has_function_privilege('anon', sig, 'EXECUTE'), 'anon cannot run ' || sig;
    ASSERT NOT has_function_privilege('authenticated', sig, 'EXECUTE'), 'customers cannot run ' || sig;
  END LOOP;

  RAISE NOTICE 'PASS: block 1 (wiring)';
END $$;


-- ── Block 2: which coupons are offered, what they give, and how a use is counted ──
DO $$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-0000000171a1';
  v_c1    UUID := '00000000-0000-0000-0000-0000000171c1';
  v_c2    UUID := '00000000-0000-0000-0000-0000000171c2';
  v_place CONSTANT TEXT := 'ChIJcpn171aaaaaaaaaa';
  v_rest  UUID;
  v_tz    TEXT;
  v_cart  JSONB := '[{"item_id":"test171_a","quantity":2},{"item_id":"test171_b","quantity":1}]'::JSONB;   -- 2 x $12.50 + $5.00 = $30.00
  v_g10 UUID; v_g2 UUID; v_ib UUID; v_if UUID; v_big UUID; v_once UUID; v_old UUID; v_off UUID; v_del UUID; v_full UUID;
  v_res   JSONB;
  v_o1    UUID;
  v_o2    UUID;
  v_n     INTEGER;
BEGIN
  BEGIN
    SELECT z INTO v_tz FROM unnest(ARRAY['America/Chicago', 'Asia/Tokyo', 'Europe/London', 'Pacific/Auckland', 'America/Los_Angeles']) z
     WHERE public._next_local_midnight(z) > NOW() + INTERVAL '5 hours' LIMIT 1;
    ASSERT v_tz IS NOT NULL, 'a timezone with room left in its day';

    INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
      (v_owner, 'cpn-171a1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_c1, 'cpn-171c1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_c2, 'cpn-171c2@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.restaurant_owners (id, business_name, email, is_active) VALUES (v_owner, 'Coupon Test', 'cpn-171a1@example.com', TRUE);
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status, timezone, ordering_enabled, ordering_prep_minutes)
    VALUES (v_owner, v_place, 'Coupon Test Diner 171', '1 Main St', 'approved', v_tz, TRUE, 20) RETURNING id INTO v_rest;

    INSERT INTO public.menu_items (item_id, restaurant_name, name, place_id, is_verified, is_out_of_stock, price_cents) VALUES
      ('test171_a', 'Coupon Test Diner 171', 'Burger', v_place, TRUE, FALSE, 1250),
      ('test171_b', 'Coupon Test Diner 171', 'Fries', v_place, TRUE, FALSE, 500),
      ('test171_s', 'Coupon Test Diner 171', 'Sold Out Soup', v_place, TRUE, TRUE, 700);

    INSERT INTO public.coupons (restaurant_id, coupon_type, discount_value, menu_item_id, coupon_code, expiry_date, usage_limit, per_user_limit) VALUES
      (v_rest, 'generic_percent', 10,  NULL,        'G10',   NOW() + INTERVAL '1 day', NULL, 5) RETURNING id INTO v_g10;
    INSERT INTO public.coupons (restaurant_id, coupon_type, discount_value, menu_item_id, coupon_code, expiry_date, usage_limit, per_user_limit)
      VALUES (v_rest, 'generic_fixed', 2, NULL, 'G2', NOW() + INTERVAL '1 day', NULL, 5) RETURNING id INTO v_g2;
    INSERT INTO public.coupons (restaurant_id, coupon_type, discount_value, menu_item_id, coupon_code, expiry_date, usage_limit, per_user_limit)
      VALUES (v_rest, 'item_percent', 20, 'test171_a', 'IB', NOW() + INTERVAL '1 day', NULL, 5) RETURNING id INTO v_ib;
    INSERT INTO public.coupons (restaurant_id, coupon_type, discount_value, menu_item_id, coupon_code, expiry_date, usage_limit, per_user_limit)
      VALUES (v_rest, 'item_fixed', 3, 'test171_b', 'IF', NOW() + INTERVAL '1 day', NULL, 5) RETURNING id INTO v_if;
    INSERT INTO public.coupons (restaurant_id, coupon_type, discount_value, menu_item_id, coupon_code, expiry_date, usage_limit, per_user_limit)
      VALUES (v_rest, 'generic_percent', 100, NULL, 'FREE', NOW() + INTERVAL '1 day', NULL, 5) RETURNING id INTO v_big;
    INSERT INTO public.coupons (restaurant_id, coupon_type, discount_value, menu_item_id, coupon_code, expiry_date, usage_limit, per_user_limit)
      VALUES (v_rest, 'generic_fixed', 1, NULL, 'ONCE', NOW() + INTERVAL '1 day', 2, 1) RETURNING id INTO v_once;
    INSERT INTO public.coupons (restaurant_id, coupon_type, discount_value, menu_item_id, coupon_code, expiry_date, usage_limit, per_user_limit)
      VALUES (v_rest, 'generic_fixed', 1, NULL, 'OLD', NOW() - INTERVAL '1 hour', NULL, 5) RETURNING id INTO v_old;
    INSERT INTO public.coupons (restaurant_id, coupon_type, discount_value, menu_item_id, coupon_code, expiry_date, usage_limit, per_user_limit, is_active)
      VALUES (v_rest, 'generic_fixed', 1, NULL, 'OFF', NOW() + INTERVAL '1 day', NULL, 5, FALSE) RETURNING id INTO v_off;
    INSERT INTO public.coupons (restaurant_id, coupon_type, discount_value, menu_item_id, coupon_code, expiry_date, usage_limit, per_user_limit, is_deleted)
      VALUES (v_rest, 'generic_fixed', 1, NULL, 'GONE', NOW() + INTERVAL '1 day', NULL, 5, TRUE) RETURNING id INTO v_del;
    INSERT INTO public.coupons (restaurant_id, coupon_type, discount_value, menu_item_id, coupon_code, expiry_date, usage_limit, times_used, per_user_limit)
      VALUES (v_rest, 'generic_fixed', 1, NULL, 'FULL', NOW() + INTERVAL '1 day', 3, 3, 5) RETURNING id INTO v_full;

    -- signed out: nothing is offered
    PERFORM set_config('request.jwt.claim.sub', '', true);
    ASSERT (SELECT COUNT(*) FROM public.get_order_coupons(v_place, v_cart)) = 0, 'signed out: no coupons';

    PERFORM set_config('request.jwt.claim.sub', v_c1::text, true);

    -- what is offered: the usable coupons, biggest saving first; expired, switched off, deleted and used-up ones are left out
    ASSERT (SELECT array_agg(coupon_code ORDER BY discount_cents DESC, coupon_code) FROM public.get_order_coupons(v_place, v_cart))
         = ARRAY['FREE', 'G10', 'IF', 'IB', 'G2', 'ONCE'], 'the usable coupons, best first';
    ASSERT (SELECT discount_cents FROM public.get_order_coupons(v_place, v_cart) WHERE coupon_code = 'G10') = 300, '10% off $30.00 is $3.00';
    ASSERT (SELECT discount_cents FROM public.get_order_coupons(v_place, v_cart) WHERE coupon_code = 'G2') = 200, '$2 off the order is $2.00';
    ASSERT (SELECT discount_cents FROM public.get_order_coupons(v_place, v_cart) WHERE coupon_code = 'IB') = 250, '20% off ONE burger ($12.50) is $2.50';
    ASSERT (SELECT discount_cents FROM public.get_order_coupons(v_place, v_cart) WHERE coupon_code = 'IF') = 300, '$3 off one Fries ($5.00) is $3.00';
    ASSERT (SELECT discount_cents FROM public.get_order_coupons(v_place, v_cart) WHERE coupon_code = 'FREE') = 2950, 'a free order still leaves 50 cents to pay';

    -- an item coupon needs its dish in the cart; a sold-out dish does not count as in the cart
    ASSERT NOT EXISTS (SELECT 1 FROM public.get_order_coupons(v_place, '[{"item_id":"test171_b","quantity":1}]'::JSONB) WHERE coupon_code = 'IB'), 'no burger, no burger coupon';
    ASSERT (SELECT COUNT(*) FROM public.get_order_coupons(v_place, '[{"item_id":"test171_s","quantity":1}]'::JSONB)) = 0, 'a sold-out dish is not priced';
    ASSERT (SELECT COUNT(*) FROM public.get_order_coupons(v_place, '[]'::JSONB)) = 0, 'an empty cart has no coupons';
    ASSERT (SELECT COUNT(*) FROM public.get_order_coupons('ChIJnoplace171xxxxxxx', v_cart)) = 0, 'another place has none';

    -- put a coupon on an unpaid order: the total changes, Stripe will be asked for it
    v_res := public.create_pickup_order(v_place, v_cart, 'Ann', NULL, NULL, 'k171-1');
    v_o1 := (v_res->>'order_id')::UUID;
    ASSERT (v_res->>'discount_cents')::INTEGER = 0 AND (v_res->>'total_cents')::INTEGER = 3000, 'no coupon at first';
    v_res := public.apply_order_coupon(v_o1, v_g10);
    ASSERT (v_res->>'discount_cents')::INTEGER = 300 AND (v_res->>'total_cents')::INTEGER = 2700 AND (v_res->>'subtotal_cents')::INTEGER = 3000, 'the order total is $27.00';
    ASSERT v_res->>'coupon_code' = 'G10', 'the order shows the code';
    ASSERT (SELECT coupon_id FROM public.orders WHERE id = v_o1) = v_g10, 'the order keeps the coupon';
    ASSERT (SELECT times_used FROM public.coupons WHERE id = v_g10) = 0, 'nothing is used up before payment';

    -- one coupon at a time: another replaces it; none takes it off
    v_res := public.apply_order_coupon(v_o1, v_if);
    ASSERT (v_res->>'discount_cents')::INTEGER = 300 AND v_res->>'coupon_code' = 'IF', 'the new coupon replaces the old';
    v_res := public.apply_order_coupon(v_o1, v_big);
    ASSERT (v_res->>'total_cents')::INTEGER = 50, 'a free order is held to 50 cents';
    v_res := public.apply_order_coupon(v_o1, NULL);
    ASSERT (v_res->>'discount_cents')::INTEGER = 0 AND (v_res->>'total_cents')::INTEGER = 3000 AND v_res->>'coupon_code' IS NULL, 'none puts it back to $30.00';

    -- coupons that cannot be used
    PERFORM pg_temp.expect_error(format($q$SELECT public.apply_order_coupon(%L, %L)$q$, v_o1, v_old), '%cannot be used%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.apply_order_coupon(%L, %L)$q$, v_o1, v_off), '%cannot be used%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.apply_order_coupon(%L, %L)$q$, v_o1, v_del), '%cannot be used%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.apply_order_coupon(%L, %L)$q$, v_o1, v_full), '%cannot be used%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.apply_order_coupon(%L, %L)$q$, v_o1, gen_random_uuid()), '%cannot be used%');

    -- an item coupon for a dish that is not in this order does nothing, so it is refused
    v_res := public.create_pickup_order(v_place, '[{"item_id":"test171_b","quantity":2}]'::JSONB, 'Ann', NULL, NULL, 'k171-2');
    v_o2 := (v_res->>'order_id')::UUID;
    PERFORM pg_temp.expect_error(format($q$SELECT public.apply_order_coupon(%L, %L)$q$, v_o2, v_ib), '%does not apply%');
    UPDATE public.orders SET status = 'cancelled' WHERE id = v_o2;

    -- only your own unpaid order
    PERFORM set_config('request.jwt.claim.sub', v_c2::text, true);
    PERFORM pg_temp.expect_error(format($q$SELECT public.apply_order_coupon(%L, %L)$q$, v_o1, v_g10), '%not found%');
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM pg_temp.expect_error(format($q$SELECT public.apply_order_coupon(%L, %L)$q$, v_o1, v_g10), '%Sign in%');
    PERFORM set_config('request.jwt.claim.sub', v_c1::text, true);

    -- not once payment has started
    v_res := public.apply_order_coupon(v_o1, v_g10);
    UPDATE public.orders SET stripe_session_id = 'cs_test_171' WHERE id = v_o1;
    PERFORM pg_temp.expect_error(format($q$SELECT public.apply_order_coupon(%L, NULL)$q$, v_o1), '%before payment starts%');
    UPDATE public.orders SET stripe_session_id = NULL WHERE id = v_o1;

    -- the total must always equal subtotal - discount
    PERFORM pg_temp.expect_error(format($q$UPDATE public.orders SET discount_cents = 100 WHERE id = %L$q$, v_o2), '%orders_total_is_sum%');

    -- paying counts the use; a repeated payment message counts nothing more
    ASSERT public.mark_order_paid(v_o1, 'pi_test_171') = 'ok', 'paid';
    ASSERT (SELECT times_used FROM public.coupons WHERE id = v_g10) = 1, 'the use is counted at payment';
    ASSERT (SELECT coupon_counted FROM public.orders WHERE id = v_o1), 'the order knows it was counted';
    ASSERT public.mark_order_paid(v_o1, 'pi_test_171') = 'ok', 'a repeat is harmless';
    ASSERT (SELECT times_used FROM public.coupons WHERE id = v_g10) = 1, 'and counts nothing more';

    -- an order without a coupon counts nothing
    v_res := public.create_pickup_order(v_place, v_cart, 'Ann', NULL, NULL, 'k171-3');
    PERFORM public.mark_order_paid((v_res->>'order_id')::UUID, 'pi_test_171b');
    ASSERT (SELECT SUM(times_used) FROM public.coupons WHERE id IN (v_g2, v_ib, v_if, v_big)) = 0, 'other coupons are untouched';

    -- cancelling a paid order (before the restaurant accepts) gives the use back, once
    ASSERT public.customer_cancel_order(v_o1) = 'ok', 'cancelled';
    ASSERT (SELECT times_used FROM public.coupons WHERE id = v_g10) = 0, 'the use is given back';
    ASSERT NOT (SELECT coupon_counted FROM public.orders WHERE id = v_o1), 'and the order no longer holds it';
    UPDATE public.orders SET status = 'refunded' WHERE id = v_o1;
    ASSERT (SELECT times_used FROM public.coupons WHERE id = v_g10) = 0, 'a later refund does not give it back twice';

    -- a customer's own limit: ONCE allows one use each, counting a paid order and their other unpaid ones
    v_res := public.create_pickup_order(v_place, v_cart, 'Ann', NULL, NULL, 'k171-4');
    v_o1 := (v_res->>'order_id')::UUID;
    PERFORM public.apply_order_coupon(v_o1, v_once);
    v_res := public.create_pickup_order(v_place, v_cart, 'Ann', NULL, NULL, 'k171-5');
    v_o2 := (v_res->>'order_id')::UUID;
    PERFORM pg_temp.expect_error(format($q$SELECT public.apply_order_coupon(%L, %L)$q$, v_o2, v_once), '%cannot be used%');
    ASSERT NOT EXISTS (SELECT 1 FROM public.get_order_coupons(v_place, v_cart) WHERE coupon_code = 'ONCE'), 'it is no longer offered to someone who has it on an unpaid order';
    PERFORM public.apply_order_coupon(v_o1, NULL);
    PERFORM public.apply_order_coupon(v_o2, v_once);   -- the first order let go of it, so the second can have it
    ASSERT public.mark_order_paid(v_o2, 'pi_test_171c') = 'ok', 'paid';
    ASSERT (SELECT times_used FROM public.coupons WHERE id = v_once) = 1, 'counted';
    ASSERT NOT EXISTS (SELECT 1 FROM public.get_order_coupons(v_place, v_cart) WHERE coupon_code = 'ONCE'), 'and used up for this customer';
    PERFORM set_config('request.jwt.claim.sub', v_c2::text, true);
    ASSERT EXISTS (SELECT 1 FROM public.get_order_coupons(v_place, v_cart) WHERE coupon_code = 'ONCE'), 'another customer can still use it';

    -- the total limit: ONCE has 2 uses in all, and both are now used
    v_res := public.create_pickup_order(v_place, v_cart, 'Bo', NULL, NULL, 'k171-6');
    PERFORM public.apply_order_coupon((v_res->>'order_id')::UUID, v_once);
    PERFORM public.mark_order_paid((v_res->>'order_id')::UUID, 'pi_test_171d');
    ASSERT (SELECT times_used FROM public.coupons WHERE id = v_once) = 2, 'two uses in all';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    SELECT COUNT(*) INTO v_n FROM public.coupons WHERE id = v_once AND times_used >= usage_limit;
    ASSERT v_n = 1, 'the total limit is reached';

    RAISE EXCEPTION 'rollback_test_171';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_171' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 2 (offering, applying, counting coupons)';
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL 171 TESTS PASSED'; END $$;

-- Test for migration 169: the customer's list of orders, and test payments. Run the WHOLE file in one go; the rules are tried inside a
-- sub-block that is rolled back. Needs migrations 165 and 168. Success: no error, and "ALL 169 TESTS PASSED".

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
  v_owner UUID := '00000000-0000-0000-0000-0000000169a1';
  v_c1    UUID := '00000000-0000-0000-0000-0000000169c1';
  v_c2    UUID := '00000000-0000-0000-0000-0000000169c2';
  v_rest  UUID;
  v_o1    UUID;
  v_o2    UUID;
  v_o3    UUID;
  v_list  JSONB;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'orderingTestMode'), 'the test-mode setting exists';
  ASSERT NOT has_function_privilege('anon', 'public.get_my_orders(integer)', 'EXECUTE'), 'anon cannot list orders';
  ASSERT has_function_privilege('authenticated', 'public.get_my_orders(integer)', 'EXECUTE'), 'a signed-in customer can';
  ASSERT NOT has_function_privilege('anon', 'public.test_mark_my_order_paid(uuid)', 'EXECUTE'), 'anon cannot run the test payment';
  ASSERT has_function_privilege('authenticated', 'public.test_mark_my_order_paid(uuid)', 'EXECUTE'), 'a signed-in customer can ask for it';

  BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
      (v_owner, 'extras-169a1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_c1, 'extras-169c1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_c2, 'extras-169c2@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.restaurant_owners (id, business_name, email, is_active) VALUES (v_owner, 'Extras Test', 'extras-169a1@example.com', TRUE);
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status, timezone, ordering_enabled)
    VALUES (v_owner, 'ChIJext169aaaaaaaaaa', 'Extras Test Diner 169', '1 Main St', 'approved', 'America/Chicago', TRUE) RETURNING id INTO v_rest;

    INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, customer_id, customer_name, status, pickup_at, subtotal_cents, total_cents, created_at)
    VALUES (v_rest, 'ChIJext169aaaaaaaaaa', 'Extras Test Diner 169', v_c1, 'Ann', 'placed', NOW() + INTERVAL '30 minutes', 1000, 1000, NOW() - INTERVAL '3 hours') RETURNING id INTO v_o1;
    INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, customer_id, customer_name, status, pickup_at, subtotal_cents, total_cents, created_at)
    VALUES (v_rest, 'ChIJext169aaaaaaaaaa', 'Extras Test Diner 169', v_c1, 'Ann', 'pending_payment', NOW() + INTERVAL '30 minutes', 2500, 2500, NOW() - INTERVAL '1 hour') RETURNING id INTO v_o2;
    INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, customer_id, customer_name, status, pickup_at, subtotal_cents, total_cents)
    VALUES (v_rest, 'ChIJext169aaaaaaaaaa', 'Extras Test Diner 169', v_c2, 'Bob', 'placed', NOW() + INTERVAL '30 minutes', 700, 700) RETURNING id INTO v_o3;
    INSERT INTO public.order_items (order_id, item_id, name, unit_price_cents, quantity) VALUES
      (v_o1, 'a', 'Burger', 500, 2), (v_o1, 'b', 'Fries', 250, 1), (v_o2, 'a', 'Burger', 500, 5);

    -- the list: only your own, newest first, with a dish count
    PERFORM set_config('request.jwt.claim.sub', v_c1::text, true);
    v_list := public.get_my_orders();
    ASSERT jsonb_array_length(v_list) = 2, 'two orders for the first customer';
    ASSERT (v_list->0->>'order_id')::UUID = v_o2 AND (v_list->1->>'order_id')::UUID = v_o1, 'newest first';
    ASSERT (v_list->1->>'item_count')::INTEGER = 3 AND (v_list->0->>'item_count')::INTEGER = 5, 'the dish count adds up the quantities';
    ASSERT v_list->1->>'restaurant_name' = 'Extras Test Diner 169' AND (v_list->1->>'total_cents')::INTEGER = 1000 AND v_list->1->>'status' = 'placed', 'the row has what the list shows';
    ASSERT NOT (v_list::TEXT LIKE '%' || v_o3::TEXT || '%'), 'another customer''s order is not there';
    ASSERT jsonb_array_length(public.get_my_orders(1)) = 1, 'the limit applies';
    ASSERT jsonb_array_length(public.get_my_orders(0)) = 1 AND jsonb_array_length(public.get_my_orders(-5)) = 1, 'a limit below 1 is treated as 1';

    PERFORM set_config('request.jwt.claim.sub', v_c2::text, true);
    ASSERT jsonb_array_length(public.get_my_orders()) = 1, 'the second customer has one';

    PERFORM set_config('request.jwt.claim.sub', '', true);
    ASSERT public.get_my_orders() = '[]'::JSONB, 'signed out: nothing';

    -- the test payment: refused while the switch is off
    PERFORM set_config('request.jwt.claim.sub', v_c1::text, true);
    UPDATE public.app_config SET value = 'false' WHERE key = 'orderingTestMode';
    PERFORM pg_temp.expect_error(format($q$SELECT public.test_mark_my_order_paid(%L)$q$, v_o2), '%switched off%');
    ASSERT (SELECT status FROM public.orders WHERE id = v_o2) = 'pending_payment', 'nothing changed';
    UPDATE public.app_config SET value = 'yes' WHERE key = 'orderingTestMode';
    PERFORM pg_temp.expect_error(format($q$SELECT public.test_mark_my_order_paid(%L)$q$, v_o2), '%switched off%');

    -- with it on: only your own order, once
    UPDATE public.app_config SET value = 'true' WHERE key = 'orderingTestMode';
    ASSERT public.test_mark_my_order_paid(v_o3) = 'not_found', 'not another customer''s order';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o3) = 'placed', 'it was not touched';
    ASSERT public.test_mark_my_order_paid(v_o2) = 'ok', 'your own unpaid order is marked paid';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o2) = 'placed', 'it is placed';
    ASSERT (SELECT stripe_payment_intent_id FROM public.orders WHERE id = v_o2) LIKE 'pi\_test\_%', 'with a clearly fake payment id';
    ASSERT public.test_mark_my_order_paid(v_o2) = 'ok', 'asking again is harmless';
    ASSERT (SELECT COUNT(*) FROM public.order_events WHERE order_id = v_o2 AND status = 'placed') = 1, 'one placed event';
    ASSERT public.test_mark_my_order_paid('00000000-0000-0000-0000-000000000000') = 'not_found', 'an unknown order is not found';

    RAISE EXCEPTION 'rollback_test_169';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_169' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 169 TESTS PASSED';
END $$;

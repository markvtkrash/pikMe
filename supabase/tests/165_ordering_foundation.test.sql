-- Test for migration 165: pickup ordering, stage 1 (settings, prices, the owner's switch, availability, order tables).
-- Run the WHOLE file in one go. Block 1 checks the wiring from the catalog; block 2 tries the rules inside a sub-block that is rolled
-- back, so nothing is left behind. Needs migrations 007, 052, 055, 062, 067 and 139 (and 165 itself). Success: no error, and "ALL 165 TESTS PASSED".

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

-- ── Block 1: settings, tables, function access ──────────────────────────────
DO $$
DECLARE
  t   TEXT;
  sig TEXT;
BEGIN
  -- ordering is off by default; the prep time defaults to 20
  ASSERT (SELECT column_default FROM information_schema.columns WHERE table_name = 'restaurants' AND column_name = 'ordering_enabled') = 'false',
    'ordering_enabled defaults to false';
  ASSERT (SELECT is_nullable FROM information_schema.columns WHERE table_name = 'restaurants' AND column_name = 'ordering_enabled') = 'NO',
    'ordering_enabled is never null';
  ASSERT (SELECT column_default FROM information_schema.columns WHERE table_name = 'restaurants' AND column_name = 'ordering_prep_minutes') = '20',
    'the prep time defaults to 20';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'menu_items' AND column_name = 'price_cents'), 'menu_items has price_cents';

  -- the order tables are closed to customers, owners and the public; the server can use them
  FOREACH t IN ARRAY ARRAY['orders', 'order_items', 'order_events'] LOOP
    ASSERT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || t)::regclass), t || ' has row level security on';
    ASSERT NOT has_table_privilege('anon', 'public.' || t, 'SELECT'), 'anon cannot read ' || t;
    ASSERT NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT'), 'customers cannot read ' || t;
    ASSERT NOT has_table_privilege('authenticated', 'public.' || t, 'INSERT'), 'customers cannot write ' || t;
    ASSERT has_table_privilege('service_role', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE'), 'the server can use ' || t;
  END LOOP;

  -- owner functions: signed-in only
  FOREACH sig IN ARRAY ARRAY[
    'public.owner_set_menu_item_price(text,integer)',
    'public.owner_set_ordering_enabled(uuid,boolean)'] LOOP
    ASSERT NOT has_function_privilege('anon', sig, 'EXECUTE'), 'anon cannot run ' || sig;
    ASSERT has_function_privilege('authenticated', sig, 'EXECUTE'), 'owners can run ' || sig;
  END LOOP;

  -- a customer's app can ask whether ordering is available
  ASSERT has_function_privilege('anon', 'public.get_ordering_info(text)', 'EXECUTE'), 'anon can ask get_ordering_info';
  ASSERT has_function_privilege('authenticated', 'public.get_ordering_info(text)', 'EXECUTE'), 'customers can ask get_ordering_info';

  -- server only
  ASSERT NOT has_function_privilege('anon', 'public._orderable_item_count(text)', 'EXECUTE'), 'anon cannot count orderable dishes';
  ASSERT NOT has_function_privilege('authenticated', 'public._orderable_item_count(text)', 'EXECUTE'), 'customers cannot count orderable dishes';
  ASSERT has_function_privilege('service_role', 'public._orderable_item_count(text)', 'EXECUTE'), 'the server can count them';

  -- an unknown place: not available, default prep time
  ASSERT (SELECT ordering_available FROM public.get_ordering_info('ChIJnosuchplace165x')) IS FALSE, 'an unknown place cannot take orders';
  ASSERT (SELECT prep_minutes FROM public.get_ordering_info('ChIJnosuchplace165x')) = 20, 'an unknown place reports the default prep time';

  RAISE NOTICE 'PASS: block 1 (wiring)';
END $$;


-- ── Block 2: prices, the ordering switch, availability, listing eligibility, order tables ──
DO $$
DECLARE
  v_owner  UUID := '00000000-0000-0000-0000-0000000165a1';
  v_other  UUID := '00000000-0000-0000-0000-0000000165a2';
  v_rest   UUID;
  v_place  CONSTANT TEXT := 'ChIJord165aaaaaaaaaa';
  v_name   CONSTANT TEXT := 'Ordering Test Diner165';
  v_info   RECORD;
  v_order  UUID;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
      (v_owner, 'ordering-165a1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_other, 'ordering-165a2@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.restaurant_owners (id, business_name, email, is_active) VALUES
      (v_owner, 'Ordering Test A', 'ordering-165a1@example.com', TRUE),
      (v_other, 'Ordering Test B', 'ordering-165a2@example.com', TRUE);
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status, timezone)
    VALUES (v_owner, v_place, v_name, '1 Main St', 'approved', 'America/Chicago') RETURNING id INTO v_rest;

    -- A: place-owned, confirmed.  B: place-owned, NOT confirmed.  T: a shared template row (no place).
    INSERT INTO public.menu_items (item_id, restaurant_name, name, place_id, is_verified) VALUES
      ('test165_a', v_name, 'Burger', v_place, TRUE),
      ('test165_b', v_name, 'Guessed Soup', v_place, FALSE),
      ('test165_t', v_name, 'Template Dish', NULL, TRUE);

    -- defaults
    ASSERT (SELECT ordering_enabled FROM public.restaurants WHERE id = v_rest) IS FALSE, 'a new restaurant has ordering off';
    ASSERT (SELECT ordering_prep_minutes FROM public.restaurants WHERE id = v_rest) = 20, 'and a 20 minute prep time';
    SELECT * INTO v_info FROM public.get_ordering_info(v_place);
    ASSERT v_info.ordering_available IS FALSE AND v_info.orderable_count = 0, 'off and nothing priced: not available';
    ASSERT v_info.restaurant_timezone = 'America/Chicago', 'the timezone is reported';

    -- the table rules on a price
    PERFORM pg_temp.expect_error($q$UPDATE public.menu_items SET price_cents = 500 WHERE item_id = 'test165_t'$q$, '%menu_items_price_cents_check%');
    PERFORM pg_temp.expect_error($q$UPDATE public.menu_items SET price_cents = 0 WHERE item_id = 'test165_a'$q$, '%menu_items_price_cents_check%');
    PERFORM pg_temp.expect_error($q$UPDATE public.menu_items SET price_cents = -5 WHERE item_id = 'test165_a'$q$, '%menu_items_price_cents_check%');
    PERFORM pg_temp.expect_error($q$UPDATE public.menu_items SET price_cents = 1000001 WHERE item_id = 'test165_a'$q$, '%menu_items_price_cents_check%');
    PERFORM pg_temp.expect_error($q$UPDATE public.restaurants SET ordering_prep_minutes = 4 WHERE google_place_id = 'ChIJord165aaaaaaaaaa'$q$, '%ordering_prep_minutes_check%');
    PERFORM pg_temp.expect_error($q$UPDATE public.restaurants SET ordering_prep_minutes = 241 WHERE google_place_id = 'ChIJord165aaaaaaaaaa'$q$, '%ordering_prep_minutes_check%');

    -- owner_set_menu_item_price: who may, and which dishes
    PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
    PERFORM pg_temp.expect_error($q$SELECT public.owner_set_menu_item_price('test165_a', 1250)$q$, '%Not authorized%');
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
    PERFORM pg_temp.expect_error($q$SELECT public.owner_set_menu_item_price('test165_nosuch', 1250)$q$, '%not found%');
    PERFORM pg_temp.expect_error($q$SELECT public.owner_set_menu_item_price('test165_t', 1250)$q$, '%your own restaurant%');
    PERFORM pg_temp.expect_error($q$SELECT public.owner_set_menu_item_price('test165_a', 0)$q$, '%between $0.01 and $10,000.00%');
    PERFORM pg_temp.expect_error($q$SELECT public.owner_set_menu_item_price('test165_a', 1000001)$q$, '%between $0.01 and $10,000.00%');
    PERFORM public.owner_set_menu_item_price('test165_b', 800);
    ASSERT (SELECT price_cents FROM public.menu_items WHERE item_id = 'test165_b') = 800, 'a price is set on an unconfirmed dish too';

    -- turning ordering on needs: an owner, an approved independent, a timezone, and an orderable dish
    PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_set_ordering_enabled(%L, TRUE)$q$, v_rest), '%Not authorized%');
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_set_ordering_enabled(%L, TRUE)$q$, v_rest), '%Confirm at least one dish%');
    ASSERT public._orderable_item_count(v_place) = 0, 'a priced but unconfirmed dish is not orderable';

    PERFORM public.owner_set_menu_item_price('test165_a', 1250);
    ASSERT (SELECT price_cents FROM public.menu_items WHERE item_id = 'test165_a') = 1250, 'the price is stored in cents';
    ASSERT public._orderable_item_count(v_place) = 1, 'a confirmed, priced, in-stock dish is orderable (the unconfirmed one is not)';

    UPDATE public.restaurants SET timezone = NULL WHERE id = v_rest;
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_set_ordering_enabled(%L, TRUE)$q$, v_rest), '%timezone%');
    UPDATE public.restaurants SET timezone = 'Not/AZone' WHERE id = v_rest;
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_set_ordering_enabled(%L, TRUE)$q$, v_rest), '%timezone%');
    UPDATE public.restaurants SET timezone = 'America/Chicago', status = 'pending' WHERE id = v_rest;
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_set_ordering_enabled(%L, TRUE)$q$, v_rest), '%must be approved%');
    UPDATE public.restaurants SET status = 'approved' WHERE id = v_rest;

    -- a franchise cannot take orders (tried with a seeded chain name, when the list has one)
    IF public.is_franchise_chain('McDonald''s') THEN
      UPDATE public.restaurants SET name = 'McDonald''s' WHERE id = v_rest;
      PERFORM pg_temp.expect_error(format($q$SELECT public.owner_set_ordering_enabled(%L, TRUE)$q$, v_rest), '%franchise%');
      UPDATE public.restaurants SET name = v_name WHERE id = v_rest;
    ELSE
      RAISE NOTICE 'no seeded franchise chain to try; franchise check skipped';
    END IF;

    -- ON
    PERFORM public.owner_set_ordering_enabled(v_rest, TRUE);
    ASSERT (SELECT ordering_enabled FROM public.restaurants WHERE id = v_rest) IS TRUE, 'ordering is on';
    SELECT * INTO v_info FROM public.get_ordering_info(v_place);
    ASSERT v_info.ordering_available IS TRUE AND v_info.orderable_count = 1 AND v_info.prep_minutes = 20, 'available, one dish, 20 minutes';

    -- and it goes off again for each reason
    UPDATE public.menu_items SET is_out_of_stock = TRUE WHERE item_id = 'test165_a';
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS FALSE, 'nothing in stock: not available';
    UPDATE public.menu_items SET is_out_of_stock = FALSE WHERE item_id = 'test165_a';
    UPDATE public.restaurants SET is_paused = TRUE WHERE id = v_rest;
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS FALSE, 'a paused restaurant: not available';
    UPDATE public.restaurants SET is_paused = FALSE WHERE id = v_rest;
    UPDATE public.restaurants SET status = 'closed' WHERE id = v_rest;
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS FALSE, 'a closed restaurant: not available';
    UPDATE public.restaurants SET status = 'approved' WHERE id = v_rest;
    UPDATE public.restaurant_owners SET is_active = FALSE WHERE id = v_owner;
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS FALSE, 'a deactivated owner: not available';
    UPDATE public.restaurant_owners SET is_active = TRUE WHERE id = v_owner;
    PERFORM public.owner_set_menu_item_price('test165_a', NULL);
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS FALSE, 'a cleared price: nothing to order, not available';
    PERFORM public.owner_set_menu_item_price('test165_a', 1250);
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS TRUE, 'available again';

    -- listing eligibility: an admin marks the restaurant not eligible (for example an unpaid monthly fee)
    INSERT INTO public.restaurant_listing (google_place_id, is_eligible, reason, manual_override, changed_by)
    VALUES (v_place, FALSE, 'monthly fee not paid', TRUE, 'test');
    UPDATE public.app_config SET value = 'false' WHERE key = 'enforceListingEligibility';
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS TRUE,
      'while the eligibility switch is off the flag is ignored, as everywhere else';
    UPDATE public.app_config SET value = 'true' WHERE key = 'enforceListingEligibility';
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS FALSE, 'not eligible and enforced: ordering is off';
    UPDATE public.restaurant_listing SET is_eligible = TRUE WHERE google_place_id = v_place;
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS TRUE, 'eligible again: ordering is back, with the owner''s switch untouched';

    -- OFF by the owner
    PERFORM public.owner_set_ordering_enabled(v_rest, FALSE);
    ASSERT (SELECT ordering_enabled FROM public.restaurants WHERE id = v_rest) IS FALSE, 'ordering is off again';
    ASSERT (SELECT ordering_available FROM public.get_ordering_info(v_place)) IS FALSE, 'and not available';

    -- orders: the table rules
    INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, customer_id, status, pickup_at, subtotal_cents, tax_cents, total_cents)
    VALUES (v_rest, v_place, v_name, v_other, 'placed', NOW() + INTERVAL '30 minutes', 2500, 206, 2706) RETURNING id INTO v_order;
    INSERT INTO public.order_items (order_id, item_id, name, unit_price_cents, quantity) VALUES (v_order, 'test165_a', 'Burger', 1250, 2);
    INSERT INTO public.order_events (order_id, status, actor) VALUES (v_order, 'placed', 'customer');
    PERFORM pg_temp.expect_error(format($q$INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, pickup_at, subtotal_cents, tax_cents, total_cents)
      VALUES (%L, 'x', 'x', NOW(), 1000, 100, 1000)$q$, v_rest), '%orders_total_is_sum%');
    PERFORM pg_temp.expect_error(format($q$INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, pickup_at, subtotal_cents, total_cents, status)
      VALUES (%L, 'x', 'x', NOW(), 1000, 1000, 'shipped')$q$, v_rest), '%orders_status_check%');
    PERFORM pg_temp.expect_error(format($q$INSERT INTO public.order_items (order_id, item_id, name, unit_price_cents, quantity) VALUES (%L, 'i', 'n', 100, 0)$q$, v_order), '%order_items_quantity_check%');
    PERFORM pg_temp.expect_error(format($q$INSERT INTO public.order_items (order_id, item_id, name, unit_price_cents, quantity) VALUES (%L, 'i', 'n', 0, 1)$q$, v_order), '%order_items_unit_price_cents_check%');
    PERFORM pg_temp.expect_error(format($q$INSERT INTO public.order_events (order_id, status, actor) VALUES (%L, 'placed', 'stranger')$q$, v_order), '%order_events_actor_check%');

    -- a dish can be replaced or deleted without touching a past order (the order keeps its own copy)
    DELETE FROM public.menu_items WHERE item_id = 'test165_a';
    ASSERT (SELECT name FROM public.order_items WHERE order_id = v_order) = 'Burger', 'the order still has its dish';

    -- deleting the restaurant keeps the order (restaurant_id becomes NULL; the name and place stay)
    DELETE FROM public.restaurants WHERE id = v_rest;
    ASSERT (SELECT restaurant_id FROM public.orders WHERE id = v_order) IS NULL AND (SELECT restaurant_name FROM public.orders WHERE id = v_order) = v_name,
      'a deleted restaurant leaves the order, with its name';

    RAISE EXCEPTION 'rollback_test_165';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_165' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 2 (prices, switch, availability, listing eligibility, order tables)';
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL 165 TESTS PASSED'; END $$;

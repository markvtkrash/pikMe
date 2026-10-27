-- Test for migration 166: pickup ordering, stage 2 (the staff link and the staff's order actions).
-- Run the WHOLE file in one go. Block 1 checks the wiring and the midnight rule; block 2 tries the rules inside a sub-block that is
-- rolled back, so nothing is left behind. Needs migration 165 (and its prerequisites). Success: no error, and "ALL 166 TESTS PASSED".

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

-- ── Block 1: wiring and the midnight rule ───────────────────────────────────
DO $$
DECLARE
  sig TEXT;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'refund_status'), 'orders has refund_status';
  ASSERT (SELECT column_default FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'refund_status') LIKE '''none''%',
    'refund_status starts as none';

  -- the link table is closed to everyone but the server
  ASSERT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.restaurant_kiosk_access'::regclass), 'the link table has row level security on';
  ASSERT NOT has_table_privilege('anon', 'public.restaurant_kiosk_access', 'SELECT'), 'anon cannot read the tokens';
  ASSERT NOT has_table_privilege('authenticated', 'public.restaurant_kiosk_access', 'SELECT'), 'customers and owners cannot read the table directly';
  ASSERT has_table_privilege('service_role', 'public.restaurant_kiosk_access', 'SELECT, INSERT, UPDATE, DELETE'), 'the server can use it';

  -- owner functions: signed in only
  FOREACH sig IN ARRAY ARRAY['public.owner_get_kiosk_link(uuid)', 'public.owner_regenerate_kiosk_token(uuid,timestamptz)'] LOOP
    ASSERT NOT has_function_privilege('anon', sig, 'EXECUTE'), 'anon cannot run ' || sig;
    ASSERT has_function_privilege('authenticated', sig, 'EXECUTE'), 'owners can run ' || sig;
  END LOOP;

  -- staff functions: no login, the token is the credential
  FOREACH sig IN ARRAY ARRAY[
    'public.kiosk_get_orders(text)', 'public.kiosk_accept_order(text,uuid)', 'public.kiosk_mark_order_ready(text,uuid)',
    'public.kiosk_mark_order_completed(text,uuid)', 'public.kiosk_reject_order(text,uuid)'] LOOP
    ASSERT has_function_privilege('anon', sig, 'EXECUTE'), 'staff without a login can run ' || sig;
  END LOOP;

  -- internals: server only
  FOREACH sig IN ARRAY ARRAY[
    'public._kiosk_restaurant(text)', 'public._kiosk_transition(text,uuid,text[],text,text,boolean)', 'public._next_local_midnight(text,timestamptz)'] LOOP
    ASSERT NOT has_function_privilege('anon', sig, 'EXECUTE'), 'anon cannot run ' || sig;
    ASSERT NOT has_function_privilege('authenticated', sig, 'EXECUTE'), 'customers cannot run ' || sig;
    ASSERT has_function_privilege('service_role', sig, 'EXECUTE'), 'the server can run ' || sig;
  END LOOP;

  -- no token, a made-up token and a badly shaped one all give the same refusal
  PERFORM pg_temp.expect_error($q$SELECT public.kiosk_get_orders(NULL)$q$, '%expired or is not valid%');
  PERFORM pg_temp.expect_error($q$SELECT public.kiosk_get_orders('garbage')$q$, '%expired or is not valid%');
  PERFORM pg_temp.expect_error(format($q$SELECT public.kiosk_get_orders(%L)$q$, 'k_' || repeat('0', 64)), '%expired or is not valid%');

  -- the midnight rule: the end of the restaurant's own day, not UTC
  ASSERT public._next_local_midnight('America/Chicago', '2026-10-25 15:00:00+00') = '2026-10-26 05:00:00+00',
    'Chicago midnight at CDT (UTC-5) is 05:00 UTC';
  ASSERT public._next_local_midnight('America/Chicago', '2026-11-01 10:00:00+00') = '2026-11-02 06:00:00+00',
    'after the clocks change back, Chicago midnight is 06:00 UTC (CST, UTC-6)';
  ASSERT public._next_local_midnight('UTC', '2026-10-25 23:59:59+00') = '2026-10-26 00:00:00+00', 'one second before midnight';
  ASSERT public._next_local_midnight('UTC', '2026-10-26 00:00:00+00') = '2026-10-27 00:00:00+00', 'exactly at midnight is the next day''s midnight';

  RAISE NOTICE 'PASS: block 1 (wiring, midnight rule)';
END $$;


-- ── Block 2: the link, the staff's view, and moving orders along ────────────
DO $$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-0000000166a1';
  v_other UUID := '00000000-0000-0000-0000-0000000166a2';
  v_rest  UUID;
  v_rest2 UUID;
  v_o1    UUID;
  v_o2    UUID;
  v_o3    UUID;
  v_o4    UUID;
  v_ox    UUID;
  v_tok   TEXT;
  v_tok2  TEXT;
  v_exp   TIMESTAMPTZ;
  v_json  JSONB;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
      (v_owner, 'kiosk-166a1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_other, 'kiosk-166a2@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.restaurant_owners (id, business_name, email, is_active) VALUES
      (v_owner, 'Kiosk Test A', 'kiosk-166a1@example.com', TRUE),
      (v_other, 'Kiosk Test B', 'kiosk-166a2@example.com', TRUE);
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status, timezone, ordering_enabled) VALUES
      (v_owner, 'ChIJkio166aaaaaaaaaa', 'Kiosk Test Diner 166', '1 Main St', 'approved', 'America/Chicago', TRUE);
    SELECT id INTO v_rest FROM public.restaurants WHERE google_place_id = 'ChIJkio166aaaaaaaaaa';
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status, timezone, ordering_enabled) VALUES
      (v_other, 'ChIJkio166bbbbbbbbbb', 'Kiosk Other Diner 166', '2 Main St', 'approved', 'America/Chicago', TRUE);
    SELECT id INTO v_rest2 FROM public.restaurants WHERE google_place_id = 'ChIJkio166bbbbbbbbbb';

    -- orders: three active (placed twice, plus one ready), one already picked up, and one at ANOTHER restaurant
    INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, customer_name, customer_note, status, pickup_at, subtotal_cents, total_cents) VALUES
      (v_rest, 'ChIJkio166aaaaaaaaaa', 'Kiosk Test Diner 166', 'Ann', 'no onions', 'placed', NOW() + INTERVAL '40 minutes', 2500, 2500) RETURNING id INTO v_o1;
    INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, customer_name, status, pickup_at, subtotal_cents, total_cents) VALUES
      (v_rest, 'ChIJkio166aaaaaaaaaa', 'Kiosk Test Diner 166', 'Bob', 'placed', NOW() + INTERVAL '20 minutes', 1000, 1000) RETURNING id INTO v_o2;
    INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, customer_name, status, pickup_at, subtotal_cents, total_cents) VALUES
      (v_rest, 'ChIJkio166aaaaaaaaaa', 'Kiosk Test Diner 166', 'Cy', 'ready', NOW() + INTERVAL '5 minutes', 700, 700) RETURNING id INTO v_o3;
    INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, customer_name, status, pickup_at, subtotal_cents, total_cents) VALUES
      (v_rest, 'ChIJkio166aaaaaaaaaa', 'Kiosk Test Diner 166', 'Di', 'picked_up', NOW() - INTERVAL '1 hour', 500, 500) RETURNING id INTO v_o4;
    INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, customer_name, status, pickup_at, subtotal_cents, total_cents) VALUES
      (v_rest2, 'ChIJkio166bbbbbbbbbb', 'Kiosk Other Diner 166', 'Eve', 'placed', NOW() + INTERVAL '10 minutes', 900, 900) RETURNING id INTO v_ox;
    INSERT INTO public.order_items (order_id, item_id, name, unit_price_cents, quantity, note) VALUES
      (v_o1, 'i1', 'Burger', 1250, 2, 'medium'),
      (v_o1, 'i2', 'Fries', 500, 1, NULL);

    -- the owner's side: who may, and what is needed
    PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
    PERFORM pg_temp.expect_error(format($q$SELECT * FROM public.owner_get_kiosk_link(%L)$q$, v_rest), '%Not authorized%');
    PERFORM pg_temp.expect_error(format($q$SELECT * FROM public.owner_regenerate_kiosk_token(%L)$q$, v_rest), '%Not authorized%');
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
    ASSERT NOT EXISTS (SELECT 1 FROM public.owner_get_kiosk_link(v_rest)), 'no link yet';

    UPDATE public.restaurants SET ordering_enabled = FALSE WHERE id = v_rest;
    PERFORM pg_temp.expect_error(format($q$SELECT * FROM public.owner_regenerate_kiosk_token(%L)$q$, v_rest), '%Turn on ordering%');
    UPDATE public.restaurants SET ordering_enabled = TRUE, timezone = NULL WHERE id = v_rest;
    PERFORM pg_temp.expect_error(format($q$SELECT * FROM public.owner_regenerate_kiosk_token(%L)$q$, v_rest), '%timezone%');
    UPDATE public.restaurants SET timezone = 'America/Chicago' WHERE id = v_rest;
    PERFORM pg_temp.expect_error(format($q$SELECT * FROM public.owner_regenerate_kiosk_token(%L, NOW() - INTERVAL '1 hour')$q$, v_rest), '%in the future%');
    PERFORM pg_temp.expect_error(format($q$SELECT * FROM public.owner_regenerate_kiosk_token(%L, NOW() + INTERVAL '32 days')$q$, v_rest), '%31 days%');

    -- a link ends at the restaurant's local midnight by default
    SELECT l.link_token, l.link_expires_at INTO v_tok, v_exp FROM public.owner_regenerate_kiosk_token(v_rest) l;
    ASSERT v_tok ~ '^k_[0-9a-f]{64}$', 'the token has the expected shape';
    ASSERT v_exp > NOW() AND v_exp <= NOW() + INTERVAL '25 hours', 'it ends within a day';
    ASSERT (v_exp AT TIME ZONE 'America/Chicago')::TIME = '00:00', 'it ends at the restaurant''s local midnight';

    -- reading the link changes nothing
    ASSERT (SELECT link_token FROM public.owner_get_kiosk_link(v_rest)) = v_tok, 'the owner can read the same link again';
    ASSERT (SELECT link_expired FROM public.owner_get_kiosk_link(v_rest)) IS FALSE, 'and it has not ended';
    ASSERT (SELECT link_token FROM public.owner_get_kiosk_link(v_rest)) = v_tok, 'reading twice gives the same token';

    -- the staff's view: only the active orders of THIS restaurant, soonest pickup first, with their dishes
    v_json := public.kiosk_get_orders(v_tok);
    ASSERT v_json->>'restaurant_name' = 'Kiosk Test Diner 166', 'the screen shows the restaurant''s name';
    ASSERT (v_json->>'expires_at')::TIMESTAMPTZ = v_exp, 'and when the link ends';
    ASSERT jsonb_array_length(v_json->'orders') = 3, 'three active orders (the picked up one and the other restaurant''s are not shown)';
    ASSERT v_json->'orders'->0->>'customer_name' = 'Cy' AND v_json->'orders'->1->>'customer_name' = 'Bob' AND v_json->'orders'->2->>'customer_name' = 'Ann',
      'soonest pickup first';
    ASSERT jsonb_array_length(v_json->'orders'->2->'items') = 2 AND v_json->'orders'->2->'items'->0->>'name' = 'Burger', 'with the dishes, in order';
    ASSERT v_json->'orders'->2->>'customer_note' = 'no onions', 'and the customer''s note';
    ASSERT v_json->'orders'->0->'customer_id' IS NULL AND v_json->'orders'->0->'stripe_payment_intent_id' IS NULL, 'no customer id or payment id is shown to staff';

    -- moving orders along
    ASSERT public.kiosk_accept_order(v_tok, v_o1) = 'ok', 'accept a placed order';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o1) = 'accepted', 'it is accepted';
    ASSERT public.kiosk_accept_order(v_tok, v_o1) = 'wrong_state', 'a second tap does nothing';
    ASSERT public.kiosk_mark_order_completed(v_tok, v_o1) = 'wrong_state', 'cannot complete an order that is not ready';
    ASSERT public.kiosk_mark_order_ready(v_tok, v_o1) = 'ok', 'mark it ready';
    ASSERT public.kiosk_mark_order_ready(v_tok, v_o1) = 'wrong_state', 'a second tap does nothing';
    ASSERT public.kiosk_mark_order_completed(v_tok, v_o1) = 'ok', 'complete it';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o1) = 'picked_up', 'it is picked up';
    ASSERT jsonb_array_length(public.kiosk_get_orders(v_tok)->'orders') = 2, 'it leaves the active list';
    ASSERT (SELECT COUNT(*) FROM public.order_events WHERE order_id = v_o1 AND actor = 'staff') = 3, 'each step is recorded, by staff';

    ASSERT public.kiosk_accept_order(v_tok, v_o3) = 'wrong_state', 'a ready order cannot be accepted';
    ASSERT public.kiosk_accept_order(v_tok, v_o4) = 'wrong_state', 'a picked up order cannot be accepted';

    -- rejecting a paid order: cancelled, and the refund is marked pending
    ASSERT public.kiosk_reject_order(v_tok, v_o2) = 'ok', 'reject a placed order';
    ASSERT (SELECT status FROM public.orders WHERE id = v_o2) = 'cancelled', 'it is cancelled';
    ASSERT (SELECT refund_status FROM public.orders WHERE id = v_o2) = 'pending', 'and the refund is pending';
    ASSERT (SELECT refund_status FROM public.orders WHERE id = v_o1) = 'none', 'other orders are untouched';
    ASSERT public.kiosk_reject_order(v_tok, v_o2) = 'wrong_state', 'a second tap does nothing';
    ASSERT public.kiosk_reject_order(v_tok, v_o3) = 'wrong_state', 'a ready order cannot be rejected';

    -- the link opens only its own restaurant
    ASSERT public.kiosk_accept_order(v_tok, v_ox) = 'not_found', 'another restaurant''s order is not found';
    ASSERT (SELECT status FROM public.orders WHERE id = v_ox) = 'placed', 'and it was not touched';
    ASSERT public.kiosk_accept_order(v_tok, '00000000-0000-0000-0000-000000000000') = 'not_found', 'an unknown order is not found';

    -- ordering switched off or the restaurant not eligible: staff can still finish the orders already placed
    UPDATE public.restaurants SET ordering_enabled = FALSE WHERE id = v_rest;
    ASSERT jsonb_array_length(public.kiosk_get_orders(v_tok)->'orders') = 1, 'the screen still works with ordering off';
    ASSERT public.kiosk_mark_order_completed(v_tok, v_o3) = 'ok', 'and so do the actions';
    UPDATE public.restaurants SET ordering_enabled = TRUE WHERE id = v_rest;

    -- a new link replaces the old one at once
    SELECT l.link_token INTO v_tok2 FROM public.owner_regenerate_kiosk_token(v_rest, NOW() + INTERVAL '7 days') l;
    ASSERT v_tok2 <> v_tok, 'a new token';
    PERFORM pg_temp.expect_error(format($q$SELECT public.kiosk_get_orders(%L)$q$, v_tok), '%expired or is not valid%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.kiosk_accept_order(%L, %L)$q$, v_tok, v_o1), '%expired or is not valid%');
    ASSERT jsonb_array_length(public.kiosk_get_orders(v_tok2)->'orders') = 0, 'the new link works';
    ASSERT (SELECT COUNT(*) FROM public.restaurant_kiosk_access WHERE restaurant_id = v_rest) = 1, 'still one row for the restaurant';
    ASSERT (SELECT link_expires_at FROM public.owner_get_kiosk_link(v_rest)) > NOW() + INTERVAL '6 days', 'a custom end time is kept';

    -- a link past its end is refused, by every function
    UPDATE public.restaurant_kiosk_access SET expires_at = NOW() - INTERVAL '1 minute' WHERE restaurant_id = v_rest;
    PERFORM pg_temp.expect_error(format($q$SELECT public.kiosk_get_orders(%L)$q$, v_tok2), '%expired or is not valid%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.kiosk_accept_order(%L, %L)$q$, v_tok2, v_ox), '%expired or is not valid%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.kiosk_mark_order_ready(%L, %L)$q$, v_tok2, v_ox), '%expired or is not valid%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.kiosk_mark_order_completed(%L, %L)$q$, v_tok2, v_ox), '%expired or is not valid%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.kiosk_reject_order(%L, %L)$q$, v_tok2, v_ox), '%expired or is not valid%');
    ASSERT (SELECT link_expired FROM public.owner_get_kiosk_link(v_rest)) IS TRUE, 'the owner sees that it has ended';

    -- a restaurant that is no longer approved loses its link
    UPDATE public.restaurant_kiosk_access SET expires_at = NOW() + INTERVAL '1 day' WHERE restaurant_id = v_rest;
    ASSERT jsonb_array_length(public.kiosk_get_orders(v_tok2)->'orders') = 0, 'the link works again with a future end';
    UPDATE public.restaurants SET status = 'closed' WHERE id = v_rest;
    PERFORM pg_temp.expect_error(format($q$SELECT public.kiosk_get_orders(%L)$q$, v_tok2), '%expired or is not valid%');

    RAISE EXCEPTION 'rollback_test_166';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_166' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 2 (link, staff view, order actions)';
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL 166 TESTS PASSED'; END $$;

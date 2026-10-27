-- Pickup ordering, stage 4 (database half): a customer places an order, sees it, and can cancel it. No payment yet.
--
--   create_pickup_order(place, items, name, pickup_at, note, key)
--       customer (signed in). Checks the restaurant can take orders (get_ordering_info), re-prices every dish from the database (the
--       app's prices are never trusted), applies the minimum order and the most of one dish, checks the pickup time (today, in the
--       restaurant's timezone, at least the prep time from now; NULL = as soon as possible) and stores the order as pending_payment.
--       A retry with the same key returns the order already made. Returns the order as JSON.
--   get_my_order(order)                        customer: their own order, or NULL.
--   customer_cancel_order(order)               customer: cancel before it is paid (pending_payment) or while the restaurant has not
--                                              accepted it (placed; the refund is then marked pending). Returns ok / wrong_state / not_found.
--   mark_order_paid(order, payment_intent)     server only (the payment webhook, later): pending_payment -> placed, once. Safe to repeat.
--   mark_order_payment_failed(order)           server only: pending_payment -> cancelled.
--   cancel_stale_pending_orders(minutes)       server only: cancels orders left unpaid for 30 minutes (a scheduled job calls it, later).
--
-- Settings (Config page): orderingMinimumCents (default 300 = $3.00), orderingMaxItemQuantity (default 20).
-- Not here: the payment itself (stage 6) and the customer app's screens.
--
-- Safe to re-run.

-- ── 1. Settings ─────────────────────────────────────────────────────────────
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('orderingMinimumCents', '300', 'Least order subtotal, in cents, a customer can pay for with online ordering (0-100000). 300 = $3.00.', 'Edge function: no env equivalent, DB-only'),
  ('orderingMaxItemQuantity', '20', 'Most of one dish in a single online order (1-50).', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

-- ── 2. One order per retry ──────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client_idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_customer_key
  ON public.orders (customer_id, client_idempotency_key) WHERE client_idempotency_key IS NOT NULL;

-- ── 3. An order as the customer sees it ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public._order_summary(p_order_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'order_id', o.id,
    'status', o.status,
    'restaurant_name', o.restaurant_name,
    'place_id', o.place_id,
    'customer_name', o.customer_name,
    'customer_note', o.customer_note,
    'pickup_at', o.pickup_at,
    'subtotal_cents', o.subtotal_cents,
    'tax_cents', o.tax_cents,
    'total_cents', o.total_cents,
    'refund_status', o.refund_status,
    'created_at', o.created_at,
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('item_id', i.item_id, 'name', i.name, 'unit_price_cents', i.unit_price_cents, 'quantity', i.quantity, 'note', i.note)
        ORDER BY i.id)
      FROM public.order_items i WHERE i.order_id = o.id
    ), '[]'::JSONB)
  )
  FROM public.orders o WHERE o.id = p_order_id;
$$;

REVOKE ALL ON FUNCTION public._order_summary(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._order_summary(UUID) TO service_role;

-- ── 4. Place an order ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_pickup_order(
  p_place_id        TEXT,
  p_items           JSONB,
  p_customer_name   TEXT,
  p_pickup_at       TIMESTAMPTZ DEFAULT NULL,
  p_note            TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_name     TEXT := left(btrim(COALESCE(p_customer_name, '')), 60);
  v_note     TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_key      TEXT := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_min      INTEGER := public._menu_setting('orderingMinimumCents', 300, 0, 100000);
  v_max_qty  INTEGER := public._menu_setting('orderingMaxItemQuantity', 20, 1, 50);
  v_now      TIMESTAMPTZ := NOW();
  v_r        public.restaurants%ROWTYPE;
  v_existing UUID;
  v_pickup   TIMESTAMPTZ;
  v_day_end  TIMESTAMPTZ;
  v_subtotal INTEGER := 0;
  v_order    UUID;
  v_line     RECORD;
  v_item     RECORD;
  v_qty      INTEGER;
  v_count    INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to place an order';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Enter the name for the order';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 300 THEN
    RAISE EXCEPTION 'The note can be at most 300 characters';
  END IF;
  IF v_key IS NOT NULL AND length(v_key) > 100 THEN
    RAISE EXCEPTION 'The request key is too long';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Choose at least one dish';
  END IF;
  IF jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'There are too many dishes in one order';
  END IF;

  -- a retry (a double tap, a flaky connection) gives back the order already made
  IF v_key IS NOT NULL THEN
    SELECT o.id INTO v_existing FROM public.orders o WHERE o.customer_id = v_uid AND o.client_idempotency_key = v_key;
    IF FOUND THEN
      RETURN public._order_summary(v_existing);
    END IF;
  END IF;

  SELECT * INTO v_r FROM public.restaurants r WHERE r.google_place_id = p_place_id;
  IF NOT FOUND OR NOT COALESCE((SELECT g.ordering_available FROM public.get_ordering_info(p_place_id) g), FALSE) THEN
    RAISE EXCEPTION 'This restaurant is not taking orders right now';
  END IF;

  -- the pickup time: today, in the restaurant's own day, at least the prep time away (a minute of slack for clocks)
  v_day_end := public._next_local_midnight(v_r.timezone, v_now);
  v_pickup := COALESCE(p_pickup_at, v_now + make_interval(mins => v_r.ordering_prep_minutes));
  IF v_pickup < v_now + make_interval(mins => v_r.ordering_prep_minutes) - INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'Pickup must be at least % minutes from now', v_r.ordering_prep_minutes;
  END IF;
  IF v_pickup >= v_day_end THEN
    RAISE EXCEPTION 'Pickup must be today, before the restaurant''s day ends';
  END IF;

  -- each dish once, with a whole quantity in range; priced from the database, never from the app
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e WHERE e->>'item_id' IS NOT NULL GROUP BY e->>'item_id' HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Each dish can be listed only once: change its quantity instead';
  END IF;
  FOR v_line IN SELECT e->>'item_id' AS item_id, e->>'quantity' AS quantity, e->>'note' AS note FROM jsonb_array_elements(p_items) e LOOP
    IF v_line.item_id IS NULL OR v_line.quantity IS NULL OR v_line.quantity !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'A dish in your order is not valid';
    END IF;
    v_qty := v_line.quantity::INTEGER;
    IF v_qty < 1 OR v_qty > v_max_qty THEN
      RAISE EXCEPTION 'You can order between 1 and % of one dish', v_max_qty;
    END IF;
    IF v_line.note IS NOT NULL AND length(v_line.note) > 140 THEN
      RAISE EXCEPTION 'A dish note can be at most 140 characters';
    END IF;
    SELECT mi.price_cents INTO v_item FROM public.menu_items mi
     WHERE mi.item_id = v_line.item_id AND mi.place_id = p_place_id AND mi.is_verified
       AND COALESCE(mi.is_out_of_stock, FALSE) = FALSE AND mi.price_cents IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A dish in your order is no longer available';
    END IF;
    v_subtotal := v_subtotal + v_item.price_cents * v_qty;
  END LOOP;

  IF v_subtotal < v_min THEN
    RAISE EXCEPTION 'The order must be at least $%', to_char(v_min / 100.0, 'FM999990.00');
  END IF;

  -- a limit on unpaid orders, so a stuck checkout cannot pile them up
  SELECT COUNT(*) INTO v_count FROM public.orders o
   WHERE o.customer_id = v_uid AND o.restaurant_id = v_r.id AND o.status = 'pending_payment' AND o.created_at > v_now - INTERVAL '30 minutes';
  IF v_count >= 3 THEN
    RAISE EXCEPTION 'You have several unpaid orders here. Finish or cancel one first';
  END IF;

  BEGIN
    INSERT INTO public.orders (restaurant_id, place_id, restaurant_name, customer_id, customer_name, customer_note, status,
                               pickup_at, subtotal_cents, tax_cents, total_cents, client_idempotency_key)
    VALUES (v_r.id, v_r.google_place_id, v_r.name, v_uid, v_name, v_note, 'pending_payment',
            v_pickup, v_subtotal, 0, v_subtotal, v_key)
    RETURNING id INTO v_order;
  EXCEPTION WHEN unique_violation THEN
    -- two taps at the same moment: the other one won; return its order
    SELECT o.id INTO v_order FROM public.orders o WHERE o.customer_id = v_uid AND o.client_idempotency_key = v_key;
    RETURN public._order_summary(v_order);
  END;

  INSERT INTO public.order_items (order_id, item_id, name, unit_price_cents, quantity, note)
  SELECT v_order, mi.item_id, mi.name, mi.price_cents, (e->>'quantity')::INTEGER, NULLIF(btrim(COALESCE(e->>'note', '')), '')
  FROM jsonb_array_elements(p_items) e
  JOIN public.menu_items mi ON mi.item_id = e->>'item_id' AND mi.place_id = p_place_id;

  INSERT INTO public.order_events (order_id, status, actor, detail) VALUES (v_order, 'pending_payment', 'customer', 'order created');
  RETURN public._order_summary(v_order);
END;
$$;

-- ── 5. See and cancel your own order ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._order_summary(o.id) FROM public.orders o WHERE o.id = p_order_id AND o.customer_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.customer_cancel_order(p_order_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old TEXT;
BEGIN
  SELECT o.status INTO v_old FROM public.orders o WHERE o.id = p_order_id AND o.customer_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_old NOT IN ('pending_payment', 'placed') THEN RETURN 'wrong_state'; END IF;

  UPDATE public.orders o
     SET status = 'cancelled', updated_at = NOW(),
         refund_status = CASE WHEN v_old = 'placed' THEN 'pending' ELSE o.refund_status END
   WHERE o.id = p_order_id;
  INSERT INTO public.order_events (order_id, status, actor, detail)
  VALUES (p_order_id, 'cancelled', 'customer', CASE WHEN v_old = 'placed' THEN 'cancelled by the customer; refund pending' ELSE 'cancelled before payment' END);
  RETURN 'ok';
END;
$$;

-- ── 6. The payment's side (server only) ─────────────────────────────────────
-- 'ok' also when the order was already paid (a repeated webhook changes nothing). 'wrong_state' when it was cancelled first: the
-- caller must then refund the payment.
CREATE OR REPLACE FUNCTION public.mark_order_paid(p_order_id UUID, p_payment_intent_id TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old TEXT;
BEGIN
  SELECT o.status INTO v_old FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_old IN ('placed', 'accepted', 'ready', 'picked_up') THEN
    UPDATE public.orders o SET stripe_payment_intent_id = COALESCE(o.stripe_payment_intent_id, p_payment_intent_id) WHERE o.id = p_order_id;
    RETURN 'ok';
  END IF;
  IF v_old <> 'pending_payment' THEN RETURN 'wrong_state'; END IF;

  UPDATE public.orders o
     SET status = 'placed', updated_at = NOW(), stripe_payment_intent_id = COALESCE(p_payment_intent_id, o.stripe_payment_intent_id)
   WHERE o.id = p_order_id;
  INSERT INTO public.order_events (order_id, status, actor, detail) VALUES (p_order_id, 'placed', 'system', 'payment confirmed');
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_order_payment_failed(p_order_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old TEXT;
BEGIN
  SELECT o.status INTO v_old FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_old = 'cancelled' THEN RETURN 'ok'; END IF;
  IF v_old <> 'pending_payment' THEN RETURN 'wrong_state'; END IF;

  UPDATE public.orders o SET status = 'cancelled', updated_at = NOW() WHERE o.id = p_order_id;
  INSERT INTO public.order_events (order_id, status, actor, detail) VALUES (p_order_id, 'cancelled', 'system', 'payment failed');
  RETURN 'ok';
END;
$$;

-- Orders whose payment never finished (the customer left checkout): cancelled after p_minutes. Returns how many.
CREATE OR REPLACE FUNCTION public.cancel_stale_pending_orders(p_minutes INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  WITH c AS (
    UPDATE public.orders o SET status = 'cancelled', updated_at = NOW()
     WHERE o.status = 'pending_payment' AND o.created_at < NOW() - make_interval(mins => GREATEST(COALESCE(p_minutes, 30), 1))
    RETURNING o.id
  )
  INSERT INTO public.order_events (order_id, status, actor, detail)
  SELECT c.id, 'cancelled', 'system', 'payment not completed in time' FROM c;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ── 7. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.create_pickup_order(TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_order(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customer_cancel_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pickup_order(TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_cancel_order(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_order_paid(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_order_payment_failed(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_stale_pending_orders(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_payment_failed(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_stale_pending_orders(INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';

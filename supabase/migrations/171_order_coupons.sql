-- Pickup ordering: a restaurant's coupon applied to an order.
--
--   get_order_coupons(place, items)       customer: the coupons they can use on this cart at this restaurant, each with the discount it
--                                         would give (worked out here from the database's prices, never the app's).
--   apply_order_coupon(order, coupon)     customer: put one coupon on their own UNPAID order (NULL takes it off). The order's total becomes
--                                         subtotal - discount; Stripe is then asked for exactly that.
--
-- Rules (the existing coupon types, applied to an order):
--   generic_percent / generic_fixed   off the whole dish total.
--   item_percent / item_fixed         off ONE unit of that dish (the dish must be in the cart); fixed is dollars off that one unit.
--   One coupon per order. The discount is never more than leaves 50 cents to pay (Stripe cannot take less, and a free order is not
--   supported). The coupon must be active, not expired, not deleted, belong to this restaurant, have room in its total limit, and the
--   customer must be under their own limit (counting coupons already shown at the restaurant's counter, paid orders, and their other
--   unpaid orders using it).
--   A use is counted when the order is PAID (mark_order_paid), and given back if the order is then cancelled or refunded.
--
-- orders gets coupon_id, coupon_code, discount_cents, coupon_counted; total = subtotal - discount + tax.
-- Safe to re-run.

-- ── 1. The order remembers its coupon ───────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS coupon_id       UUID REFERENCES public.coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_code     TEXT,
  ADD COLUMN IF NOT EXISTS discount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  ADD COLUMN IF NOT EXISTS coupon_counted  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_total_is_sum;
ALTER TABLE public.orders ADD CONSTRAINT orders_total_is_sum
  CHECK (discount_cents <= subtotal_cents AND total_cents = subtotal_cents - discount_cents + tax_cents);

-- ── 2. The order as the customer sees it: with the discount ─────────────────
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
    'discount_cents', o.discount_cents,
    'coupon_code', o.coupon_code,
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

-- ── 3. The discount a coupon gives on some lines ────────────────────────────
-- p_lines: [{item_id, unit_price_cents, quantity}]. Returns cents (0 when the coupon does not apply to these lines).
CREATE OR REPLACE FUNCTION public._coupon_discount_cents(p_coupon_id UUID, p_lines JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        public.coupons%ROWTYPE;
  v_sub    INTEGER;
  v_unit   INTEGER;
  v_disc   INTEGER := 0;
BEGIN
  SELECT * INTO c FROM public.coupons WHERE id = p_coupon_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(SUM((e->>'unit_price_cents')::INTEGER * (e->>'quantity')::INTEGER), 0) INTO v_sub FROM jsonb_array_elements(p_lines) e;

  IF c.coupon_type = 'generic_percent' THEN
    v_disc := floor(v_sub * c.discount_value / 100)::INTEGER;
  ELSIF c.coupon_type = 'generic_fixed' THEN
    v_disc := round(c.discount_value * 100)::INTEGER;
  ELSIF c.coupon_type IN ('item_percent', 'item_fixed') THEN
    SELECT (e->>'unit_price_cents')::INTEGER INTO v_unit FROM jsonb_array_elements(p_lines) e WHERE e->>'item_id' = c.menu_item_id LIMIT 1;
    IF v_unit IS NULL THEN RETURN 0; END IF;
    IF c.coupon_type = 'item_percent' THEN
      v_disc := floor(v_unit * c.discount_value / 100)::INTEGER;
    ELSE
      v_disc := LEAST(round(c.discount_value * 100)::INTEGER, v_unit);
    END IF;
  END IF;

  -- at least 50 cents must be left to pay
  RETURN GREATEST(0, LEAST(v_disc, v_sub - 50));
END;
$$;

REVOKE ALL ON FUNCTION public._coupon_discount_cents(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._coupon_discount_cents(UUID, JSONB) TO service_role;

-- Can this customer use this coupon at this restaurant now? p_except_order: their own order being changed (not counted against them).
CREATE OR REPLACE FUNCTION public._coupon_usable(p_coupon_id UUID, p_restaurant_id UUID, p_user UUID, p_except_order UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c      public.coupons%ROWTYPE;
  v_uses INTEGER;
BEGIN
  SELECT * INTO c FROM public.coupons WHERE id = p_coupon_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF c.restaurant_id <> p_restaurant_id OR c.is_deleted OR NOT c.is_active OR c.expiry_date <= NOW() THEN RETURN FALSE; END IF;
  IF c.usage_limit IS NOT NULL AND c.times_used >= c.usage_limit THEN RETURN FALSE; END IF;

  v_uses := (SELECT COUNT(*) FROM public.coupon_activations a WHERE a.coupon_id = c.id AND a.user_id = p_user)
          + (SELECT COUNT(*) FROM public.orders o
              WHERE o.coupon_id = c.id AND o.customer_id = p_user AND o.id IS DISTINCT FROM p_except_order
                AND (o.coupon_counted OR (o.status = 'pending_payment' AND o.created_at > NOW() - INTERVAL '30 minutes')));
  RETURN v_uses < c.per_user_limit;
END;
$$;

REVOKE ALL ON FUNCTION public._coupon_usable(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._coupon_usable(UUID, UUID, UUID, UUID) TO service_role;

-- ── 4. The coupons a customer can use on this cart ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_order_coupons(p_place_id TEXT, p_items JSONB)
RETURNS TABLE (coupon_id UUID, coupon_code TEXT, coupon_type TEXT, discount_value NUMERIC, menu_item_id TEXT, discount_cents INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_rid   UUID;
  v_lines JSONB;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 60 THEN RETURN; END IF;
  SELECT r.id INTO v_rid FROM public.restaurants r WHERE r.google_place_id = p_place_id;
  IF v_rid IS NULL THEN RETURN; END IF;

  -- priced from the database; a dish that is not orderable is left out
  SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id', mi.item_id, 'unit_price_cents', mi.price_cents, 'quantity', LEAST(GREATEST((e->>'quantity')::INTEGER, 1), 50))), '[]'::JSONB)
    INTO v_lines
    FROM jsonb_array_elements(p_items) e
    JOIN public.menu_items mi ON mi.item_id = e->>'item_id' AND mi.place_id = p_place_id AND mi.is_verified
     AND COALESCE(mi.is_out_of_stock, FALSE) = FALSE AND mi.price_cents IS NOT NULL
   WHERE e->>'quantity' ~ '^[0-9]{1,3}$';

  RETURN QUERY
  SELECT c.id, c.coupon_code, c.coupon_type, c.discount_value, c.menu_item_id, d.cents
    FROM public.coupons c
    CROSS JOIN LATERAL (SELECT public._coupon_discount_cents(c.id, v_lines) AS cents) d
   WHERE c.restaurant_id = v_rid AND public._coupon_usable(c.id, v_rid, v_uid) AND d.cents > 0
   ORDER BY d.cents DESC, c.coupon_code;
END;
$$;

-- ── 5. Put a coupon on an unpaid order (or take it off) ─────────────────────
CREATE OR REPLACE FUNCTION public.apply_order_coupon(p_order_id UUID, p_coupon_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  o       public.orders%ROWTYPE;
  v_code  TEXT;
  v_disc  INTEGER := 0;
  v_lines JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to place an order'; END IF;
  SELECT * INTO o FROM public.orders WHERE id = p_order_id AND customer_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That order was not found'; END IF;
  IF o.status <> 'pending_payment' OR o.stripe_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'A coupon can only be changed before payment starts';
  END IF;

  IF p_coupon_id IS NOT NULL THEN
    IF NOT public._coupon_usable(p_coupon_id, o.restaurant_id, v_uid, o.id) THEN
      RAISE EXCEPTION 'That coupon cannot be used right now';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id', i.item_id, 'unit_price_cents', i.unit_price_cents, 'quantity', i.quantity)), '[]'::JSONB)
      INTO v_lines FROM public.order_items i WHERE i.order_id = o.id;
    v_disc := public._coupon_discount_cents(p_coupon_id, v_lines);
    IF v_disc <= 0 THEN RAISE EXCEPTION 'That coupon does not apply to this order'; END IF;
    SELECT c.coupon_code INTO v_code FROM public.coupons c WHERE c.id = p_coupon_id;
  END IF;

  UPDATE public.orders x
     SET coupon_id = p_coupon_id, coupon_code = v_code, discount_cents = v_disc,
         total_cents = x.subtotal_cents - v_disc + x.tax_cents, updated_at = NOW()
   WHERE x.id = o.id;
  RETURN public._order_summary(o.id);
END;
$$;

-- ── 6. A use is counted when the order is paid ──────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_order_paid(p_order_id UUID, p_payment_intent_id TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old    TEXT;
  v_coupon UUID;
BEGIN
  SELECT o.status, o.coupon_id INTO v_old, v_coupon FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_old IN ('placed', 'accepted', 'ready', 'picked_up') THEN
    UPDATE public.orders o SET stripe_payment_intent_id = COALESCE(o.stripe_payment_intent_id, p_payment_intent_id) WHERE o.id = p_order_id;
    RETURN 'ok';
  END IF;
  IF v_old <> 'pending_payment' THEN RETURN 'wrong_state'; END IF;

  UPDATE public.orders o
     SET status = 'placed', updated_at = NOW(), stripe_payment_intent_id = COALESCE(p_payment_intent_id, o.stripe_payment_intent_id),
         coupon_counted = (v_coupon IS NOT NULL)
   WHERE o.id = p_order_id;
  -- the money is taken, so the discount is honoured even if the coupon filled up in the meantime
  IF v_coupon IS NOT NULL THEN
    UPDATE public.coupons c SET times_used = c.times_used + 1 WHERE c.id = v_coupon;
  END IF;
  INSERT INTO public.order_events (order_id, status, actor, detail) VALUES (p_order_id, 'placed', 'system', 'payment confirmed');
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.mark_order_paid(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(UUID, TEXT) TO service_role;

-- ... and given back when the order ends cancelled or refunded, whichever way that happens
CREATE OR REPLACE FUNCTION public._return_order_coupon_use()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.coupon_counted AND NEW.status IN ('cancelled', 'refunded') AND OLD.status NOT IN ('cancelled', 'refunded') THEN
    UPDATE public.coupons c SET times_used = GREATEST(c.times_used - 1, 0) WHERE c.id = OLD.coupon_id;
    NEW.coupon_counted := FALSE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_return_order_coupon_use ON public.orders;
CREATE TRIGGER trg_return_order_coupon_use
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public._return_order_coupon_use();

-- ── 7. Who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_order_coupons(TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_order_coupon(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_coupons(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_order_coupon(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

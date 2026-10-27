-- Pickup ordering, stage 1: the database. Nothing in the apps uses it yet, and ordering is OFF for every restaurant.
--
-- Scope (decided with the owner of the product): INDEPENDENT restaurants only (a place-owned menu: menu_items.place_id is set).
-- A franchise shares one chain menu across its branches, so it cannot hold a price and cannot take orders.
--
--   restaurants.ordering_enabled         OFF by default. The owner switches it on (owner_set_ordering_enabled); only then does a
--                                        customer see ordering for that restaurant (get_ordering_info).
--   restaurants.ordering_prep_minutes    least notice for a pickup (5-240, default 20).
--   menu_items.price_cents               the owner's price in whole cents. Allowed only on a place-owned row. A dish can be ordered
--                                        when it is place-owned, confirmed (is_verified), in stock, and has a price.
--   orders / order_items / order_events  the orders. Closed to customers and owners: they are read and written by functions
--                                        added in later stages. order_items keep their own copy of the name and price.
--
--   owner_set_menu_item_price(item, cents)       owner: set or clear (NULL) the price of one of their own dishes.
--   owner_set_ordering_enabled(restaurant, on)   owner: switch ordering on or off. Turning it on needs an approved independent
--                                                restaurant with a timezone and at least one orderable dish.
--   get_ordering_info(place)                     anyone: is ordering available now for this place, the prep time and timezone.
--
-- Unpaid monthly fee: an admin marks the restaurant "not eligible" (listing eligibility, migration 139). get_ordering_info then
-- reports ordering as unavailable (it requires restaurant_is_listed), and the order-placing function added in a later stage must
-- check the same rule. That works only while the admin switch enforceListingEligibility is ON.
--
-- The staff order screen and its expiring link are NOT in this migration; they come in stage 2.
--
-- Safe to re-run.

-- ── 1. Restaurant settings ──────────────────────────────────────────────────
-- timezone is migration 159's column (an IANA name such as America/Chicago); added here too, in case 159 was not applied. A no-op if it is.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS ordering_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ordering_prep_minutes INTEGER NOT NULL DEFAULT 20;

ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_ordering_prep_minutes_check;
ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_ordering_prep_minutes_check CHECK (ordering_prep_minutes BETWEEN 5 AND 240);

COMMENT ON COLUMN public.restaurants.ordering_enabled IS
  'Owner-controlled. OFF by default; customers see ordering for the restaurant only while it is on (and the restaurant is otherwise able to take orders: see get_ordering_info).';

-- ── 2. The price of a dish ──────────────────────────────────────────────────
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS price_cents INTEGER;

-- A price belongs to ONE location's own dish. A shared chain row (place_id NULL) is used by every branch, so it can have none.
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_price_cents_check;
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_price_cents_check
  CHECK (price_cents IS NULL OR (price_cents BETWEEN 1 AND 1000000 AND place_id IS NOT NULL));

COMMENT ON COLUMN public.menu_items.price_cents IS
  'The owner''s price in whole cents (US dollars x 100). Only on a place-owned row (place_id set). NULL = not for sale. Set through owner_set_menu_item_price.';

-- ── 3. Orders (closed to customers and owners: functions only, added in later stages) ──
CREATE TABLE IF NOT EXISTS public.orders (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id            UUID REFERENCES public.restaurants (id) ON DELETE SET NULL,
  place_id                 TEXT NOT NULL,
  restaurant_name          TEXT NOT NULL,
  customer_id              UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  customer_name            TEXT,
  customer_note            TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending_payment'
                           CHECK (status IN ('pending_payment', 'placed', 'accepted', 'ready', 'picked_up', 'cancelled', 'refunded')),
  pickup_at                TIMESTAMPTZ NOT NULL,
  subtotal_cents           INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents                INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents              INTEGER NOT NULL CHECK (total_cents >= 0),
  currency                 TEXT NOT NULL DEFAULT 'usd',
  stripe_session_id        TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_total_is_sum CHECK (total_cents = subtotal_cents + tax_cents)
);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status ON public.orders (restaurant_id, status, pickup_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.order_items (
  id               BIGSERIAL PRIMARY KEY,
  order_id         UUID NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  item_id          TEXT NOT NULL,        -- no foreign key: a menu replace deletes and re-adds the dish; the order keeps its own copy below
  name             TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  quantity         INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  note             TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);

CREATE TABLE IF NOT EXISTS public.order_events (
  id         BIGSERIAL PRIMARY KEY,
  order_id   UUID NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  actor      TEXT NOT NULL CHECK (actor IN ('customer', 'staff', 'owner', 'admin', 'system')),
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON public.order_events (order_id, created_at);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orders, public.order_items, public.order_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.orders, public.order_items, public.order_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.order_items_id_seq, public.order_events_id_seq TO service_role;

-- ── 4. Helper ───────────────────────────────────────────────────────────────
-- Dishes a customer could order at one place: the place's own, confirmed, in stock, with a price.
CREATE OR REPLACE FUNCTION public._orderable_item_count(p_place_id TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.menu_items mi
  WHERE mi.place_id = p_place_id
    AND mi.is_verified
    AND COALESCE(mi.is_out_of_stock, FALSE) = FALSE
    AND mi.price_cents IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public._orderable_item_count(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._orderable_item_count(TEXT) TO service_role;

-- ── 5. The owner sets a price ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.owner_set_menu_item_price(p_item_id TEXT, p_price_cents INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_place TEXT;
  v_name  TEXT;
BEGIN
  SELECT mi.place_id, mi.restaurant_name INTO v_place, v_name FROM public.menu_items mi WHERE mi.item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That menu item was not found';
  END IF;
  IF v_place IS NULL THEN
    RAISE EXCEPTION 'A price can only be set on a dish of your own restaurant''s menu';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r.google_place_id = v_place AND r.owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to manage this restaurant';
  END IF;
  IF public.is_franchise_chain(v_name) THEN
    RAISE EXCEPTION 'Ordering is not available for franchise restaurants';
  END IF;
  IF p_price_cents IS NOT NULL AND (p_price_cents < 1 OR p_price_cents > 1000000) THEN
    RAISE EXCEPTION 'The price must be between $0.01 and $10,000.00';
  END IF;

  UPDATE public.menu_items SET price_cents = p_price_cents WHERE item_id = p_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_set_menu_item_price(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_set_menu_item_price(TEXT, INTEGER) TO authenticated;

-- ── 6. The owner switches ordering on or off ────────────────────────────────
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
  END IF;

  UPDATE public.restaurants SET ordering_enabled = (p_enabled IS TRUE), updated_at = NOW() WHERE id = p_restaurant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_set_ordering_enabled(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_set_ordering_enabled(UUID, BOOLEAN) TO authenticated;

-- ── 7. What a customer's app asks when it opens a restaurant ────────────────
-- Read live (not through the 7-day search cache), so the owner's switch takes effect at once.
-- ordering_available is TRUE only when ordering is on, the restaurant is approved, listed and not paused, has a timezone, is not a
-- franchise, and has at least one orderable dish. "Listed" includes listing eligibility (migration 139): an admin who marks a
-- restaurant not eligible (for example an unpaid monthly fee) turns its ordering off, while enforceListingEligibility is ON.
-- A place that is not a pikMe restaurant gets FALSE.
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
       AND public.restaurant_is_listed(p_place_id)),
    v_r.ordering_prep_minutes,
    v_r.timezone,
    v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ordering_info(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ordering_info(TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

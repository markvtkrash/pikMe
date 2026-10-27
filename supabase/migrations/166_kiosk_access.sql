-- Pickup ordering, stage 2: the staff order screen's access (the "kiosk" link) and the staff's order actions. Database only.
--
-- Staff open a secret link on a tablet. The link is the only credential: no login, no access to anything but that one restaurant's
-- orders. It ends at the restaurant's own midnight by default (restaurants.timezone), or at a time the owner picks (up to 31 days).
-- A new link replaces the old one at once. This follows ORDERING-SYSTEM-PLAN.md: the staff functions are callable without a login and
-- are scoped by the token, like get_place_share_info / restaurant_is_listed are scoped by a place id.
--
--   restaurant_kiosk_access            one row per restaurant: the current token and when it ends. Closed to everyone but the server.
--   owner_get_kiosk_link(restaurant)           owner: the current link's token and end time (a pure read; shows if it has ended).
--   owner_regenerate_kiosk_token(restaurant, ends_at DEFAULT NULL)
--                                              owner: a new token (the old one stops at once). Needs ordering on and a timezone.
--                                              ends_at NULL = tonight at local midnight; a custom time must be 1 minute to 31 days away.
--   kiosk_get_orders(token)                    staff: the restaurant's active orders (placed, accepted, ready), oldest pickup first.
--   kiosk_accept_order / kiosk_mark_order_ready / kiosk_mark_order_completed / kiosk_reject_order (token, order)
--                                              staff: move one order along. Each returns 'ok', 'wrong_state' (someone already moved
--                                              it) or 'not_found'. A bad or ended token raises "This link has expired or is not valid".
--
-- A link keeps working for the orders already placed even if the owner switches ordering off or an admin marks the restaurant not
-- eligible: customers have paid, so staff must still be able to finish them. Those switches stop NEW orders (stage 4), not the screen.
-- Rejecting an order marks it cancelled with refund_status 'pending'; the refund itself is made by an edge function in a later stage.
--
-- Safe to re-run.

-- ── 1. Refund state on an order ─────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'none'
  CHECK (refund_status IN ('none', 'pending', 'succeeded', 'failed'));

-- ── 2. The link ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.restaurant_kiosk_access (
  restaurant_id  UUID PRIMARY KEY REFERENCES public.restaurants (id) ON DELETE CASCADE,
  token          TEXT NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  regenerated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.restaurant_kiosk_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurant_kiosk_access FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.restaurant_kiosk_access TO service_role;

-- ── 3. Helpers ──────────────────────────────────────────────────────────────
-- The next midnight in a restaurant's own timezone (the end of its day), as a moment in time.
CREATE OR REPLACE FUNCTION public._next_local_midnight(p_timezone TEXT, p_now TIMESTAMPTZ DEFAULT NOW())
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT (date_trunc('day', p_now AT TIME ZONE p_timezone) + INTERVAL '1 day') AT TIME ZONE p_timezone;
$$;

-- The restaurant a live link opens. Every staff function starts here; there is no other way in. A token that is the wrong shape,
-- unknown, replaced or past its end raises one message, so the screen can show "this link has ended" and nothing else is revealed.
CREATE OR REPLACE FUNCTION public._kiosk_restaurant(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_token IS NOT NULL AND p_token ~ '^k_[0-9a-f]{64}$' THEN
    SELECT k.restaurant_id INTO v_id
    FROM public.restaurant_kiosk_access k
    JOIN public.restaurants r ON r.id = k.restaurant_id
    WHERE k.token = p_token
      AND k.expires_at > NOW()
      AND r.status = 'approved';
  END IF;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'This link has expired or is not valid';
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public._next_local_midnight(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._kiosk_restaurant(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._next_local_midnight(TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public._kiosk_restaurant(TEXT) TO service_role;

-- ── 4. The owner's side ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.owner_get_kiosk_link(p_restaurant_id UUID)
RETURNS TABLE (link_token TEXT, link_expires_at TIMESTAMPTZ, link_expired BOOLEAN)
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
    SELECT k.token, k.expires_at, (k.expires_at <= NOW())
    FROM public.restaurant_kiosk_access k
    WHERE k.restaurant_id = p_restaurant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_regenerate_kiosk_token(p_restaurant_id UUID, p_expires_at TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (link_token TEXT, link_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r       public.restaurants%ROWTYPE;
  v_token   TEXT;
  v_expires TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_r FROM public.restaurants r WHERE r.id = p_restaurant_id;
  IF NOT FOUND OR v_r.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to manage this restaurant';
  END IF;
  IF NOT v_r.ordering_enabled THEN
    RAISE EXCEPTION 'Turn on ordering before creating a staff link';
  END IF;
  IF v_r.timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_r.timezone) THEN
    RAISE EXCEPTION 'Set your restaurant''s timezone before creating a staff link';
  END IF;

  IF p_expires_at IS NULL THEN
    v_expires := public._next_local_midnight(v_r.timezone);
  ELSE
    IF p_expires_at < NOW() + INTERVAL '1 minute' THEN
      RAISE EXCEPTION 'The link must end in the future';
    END IF;
    IF p_expires_at > NOW() + INTERVAL '31 days' THEN
      RAISE EXCEPTION 'A link can last at most 31 days';
    END IF;
    v_expires := p_expires_at;
  END IF;

  v_token := 'k_' || replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');

  INSERT INTO public.restaurant_kiosk_access AS k (restaurant_id, token, expires_at)
  VALUES (p_restaurant_id, v_token, v_expires)
  ON CONFLICT (restaurant_id) DO UPDATE
    SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, regenerated_at = NOW();

  RETURN QUERY SELECT v_token, v_expires;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_get_kiosk_link(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_regenerate_kiosk_token(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_get_kiosk_link(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_regenerate_kiosk_token(UUID, TIMESTAMPTZ) TO authenticated;

-- ── 5. The staff's side ─────────────────────────────────────────────────────
-- One JSON document: the restaurant's name, when the link ends, the server's clock, and the active orders with their dishes.
-- Only what staff need: no customer id, email or payment details.
CREATE OR REPLACE FUNCTION public.kiosk_get_orders(p_kiosk_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest   UUID := public._kiosk_restaurant(p_kiosk_token);
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'restaurant_name', r.name,
    'expires_at', k.expires_at,
    'server_time', NOW(),
    'orders', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'status', o.status,
          'pickup_at', o.pickup_at,
          'created_at', o.created_at,
          'customer_name', o.customer_name,
          'customer_note', o.customer_note,
          'total_cents', o.total_cents,
          'items', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object('name', i.name, 'quantity', i.quantity, 'note', i.note, 'unit_price_cents', i.unit_price_cents)
              ORDER BY i.id)
            FROM public.order_items i WHERE i.order_id = o.id
          ), '[]'::JSONB)
        )
        ORDER BY o.pickup_at, o.created_at)
      FROM public.orders o
      WHERE o.restaurant_id = v_rest AND o.status IN ('placed', 'accepted', 'ready')
    ), '[]'::JSONB))
  INTO v_result
  FROM public.restaurants r
  JOIN public.restaurant_kiosk_access k ON k.restaurant_id = r.id
  WHERE r.id = v_rest;

  RETURN v_result;
END;
$$;

-- Moves one order of the link's restaurant from one of the allowed states to the next, in one atomic step, so two taps (or two
-- tablets) cannot both win. Returns 'ok', 'wrong_state' (the order exists but is not in an allowed state: someone moved it first),
-- or 'not_found' (no such order at this restaurant).
CREATE OR REPLACE FUNCTION public._kiosk_transition(
  p_token TEXT, p_order_id UUID, p_from TEXT[], p_to TEXT, p_detail TEXT, p_refund BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest UUID := public._kiosk_restaurant(p_token);
  v_id   UUID;
BEGIN
  UPDATE public.orders o
     SET status = p_to,
         updated_at = NOW(),
         refund_status = CASE WHEN p_refund THEN 'pending' ELSE o.refund_status END
   WHERE o.id = p_order_id AND o.restaurant_id = v_rest AND o.status = ANY (p_from)
   RETURNING o.id INTO v_id;

  IF v_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.restaurant_id = v_rest) THEN
      RETURN 'wrong_state';
    END IF;
    RETURN 'not_found';
  END IF;

  INSERT INTO public.order_events (order_id, status, actor, detail) VALUES (v_id, p_to, 'staff', p_detail);
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.kiosk_accept_order(p_kiosk_token TEXT, p_order_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._kiosk_transition(p_kiosk_token, p_order_id, ARRAY['placed'], 'accepted', 'accepted by staff', FALSE);
$$;

CREATE OR REPLACE FUNCTION public.kiosk_mark_order_ready(p_kiosk_token TEXT, p_order_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._kiosk_transition(p_kiosk_token, p_order_id, ARRAY['accepted'], 'ready', 'marked ready by staff', FALSE);
$$;

CREATE OR REPLACE FUNCTION public.kiosk_mark_order_completed(p_kiosk_token TEXT, p_order_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._kiosk_transition(p_kiosk_token, p_order_id, ARRAY['ready'], 'picked_up', 'picked up', FALSE);
$$;

-- A paid order (placed or accepted) can be rejected; the customer is owed a refund, made by the refund function in a later stage.
CREATE OR REPLACE FUNCTION public.kiosk_reject_order(p_kiosk_token TEXT, p_order_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._kiosk_transition(p_kiosk_token, p_order_id, ARRAY['placed', 'accepted'], 'cancelled', 'rejected by staff; refund pending', TRUE);
$$;

REVOKE ALL ON FUNCTION public._kiosk_transition(TEXT, UUID, TEXT[], TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._kiosk_transition(TEXT, UUID, TEXT[], TEXT, TEXT, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION public.kiosk_get_orders(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiosk_accept_order(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiosk_mark_order_ready(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiosk_mark_order_completed(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiosk_reject_order(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_get_orders(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_accept_order(TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_mark_order_ready(TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_mark_order_completed(TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_reject_order(TEXT, UUID) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Migration: 038_coupon_per_user_limit
-- Purpose: Coupons could previously only ever be used once per customer,
--          hardcoded via a UNIQUE(coupon_id, user_id) constraint on
--          coupon_activations. This lets an owner set how many times the
--          SAME customer may redeem a coupon (usage_limit stays the total
--          across all customers combined; this is the new per-customer cap
--          within that total). Existing coupons default to 1, preserving
--          today's behavior exactly.
-- Date: 2026-09-20

-- ── 1. New column ────────────────────────────────────────────────────────────
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS per_user_limit INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.coupons
  ADD CONSTRAINT per_user_limit_positive CHECK (per_user_limit > 0);

COMMENT ON COLUMN public.coupons.per_user_limit IS 'Max times the SAME customer may redeem this coupon. usage_limit remains the combined cap across all customers.';

-- ── 2. Allow multiple activation rows per (coupon, user) ────────────────────
-- Previously capped at exactly one row per pair (once-ever enforcement). Each
-- row now represents one redemption instance; per_user_limit is enforced by
-- counting rows instead of relying on a uniqueness constraint.
ALTER TABLE public.coupon_activations
  DROP CONSTRAINT IF EXISTS unique_activation_per_user_coupon;

-- ── 3. activate_coupon: enforce per_user_limit via row count ────────────────
CREATE OR REPLACE FUNCTION public.activate_coupon(p_coupon_id UUID)
RETURNS TABLE (
  activated_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  already_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing RECORD;
  v_per_user_limit INTEGER;
  v_use_count INTEGER;
  v_claimed_id UUID;
  v_new RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Idempotent: reopening a still-OPEN countdown must never burn a second use.
  -- (closed_at IS NULL — a previously closed redemption doesn't count as "open.")
  SELECT ca.activated_at, ca.expires_at INTO v_existing
  FROM public.coupon_activations ca
  WHERE ca.coupon_id = p_coupon_id AND ca.user_id = v_user_id AND ca.closed_at IS NULL
  ORDER BY ca.activated_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.activated_at, v_existing.expires_at, true;
    RETURN;
  END IF;

  -- Per-customer limit: how many times has this specific user already
  -- redeemed this coupon (open or closed, all count as a used redemption).
  SELECT c.per_user_limit INTO v_per_user_limit FROM public.coupons c WHERE c.id = p_coupon_id;
  IF v_per_user_limit IS NULL THEN
    RAISE EXCEPTION 'Coupon not found';
  END IF;

  SELECT COUNT(*) INTO v_use_count
  FROM public.coupon_activations
  WHERE coupon_id = p_coupon_id AND user_id = v_user_id;

  IF v_use_count >= v_per_user_limit THEN
    RAISE EXCEPTION 'You have already used this coupon the maximum number of times.';
  END IF;

  -- Atomically claim one use from the combined total, only if the coupon is
  -- still valid and has room.
  UPDATE public.coupons
  SET times_used = times_used + 1
  WHERE id = p_coupon_id
    AND is_deleted = false
    AND is_active = true
    AND expiry_date > NOW()
    AND (usage_limit IS NULL OR times_used < usage_limit)
  RETURNING id INTO v_claimed_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon is no longer available';
  END IF;

  INSERT INTO public.coupon_activations (coupon_id, user_id, expires_at)
  VALUES (p_coupon_id, v_user_id, NOW() + INTERVAL '5 minutes')
  RETURNING coupon_activations.activated_at, coupon_activations.expires_at INTO v_new;

  RETURN QUERY SELECT v_new.activated_at, v_new.expires_at, false;
END;
$$;

-- ── 4. get_active_coupons_for_restaurant: hide once a user hits their own cap ─
DROP FUNCTION IF EXISTS public.get_active_coupons_for_restaurant(UUID);

CREATE FUNCTION public.get_active_coupons_for_restaurant(p_restaurant_id UUID)
RETURNS TABLE (
  id UUID,
  restaurant_id UUID,
  coupon_code TEXT,
  coupon_type TEXT,
  discount_value NUMERIC,
  menu_item_id TEXT,
  is_active BOOLEAN,
  expiry_date TIMESTAMP WITH TIME ZONE,
  usage_limit INTEGER,
  times_used INTEGER,
  per_user_limit INTEGER,
  user_uses_count INTEGER,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  activated_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.restaurant_id,
    c.coupon_code,
    c.coupon_type,
    c.discount_value,
    c.menu_item_id,
    c.is_active,
    c.expiry_date,
    c.usage_limit,
    c.times_used,
    c.per_user_limit,
    COALESCE(counts.use_count, 0)::INTEGER AS user_uses_count,
    c.created_at,
    c.updated_at,
    openact.activated_at,
    openact.expires_at
  FROM public.coupons c
  -- The user's current OPEN (not-yet-closed) redemption window, if any — this
  -- is what drives the "tap to activate" vs "active — tap to view" state.
  LEFT JOIN LATERAL (
    SELECT ca.activated_at, ca.expires_at
    FROM public.coupon_activations ca
    WHERE ca.coupon_id = c.id AND ca.user_id = auth.uid() AND ca.closed_at IS NULL
    ORDER BY ca.activated_at DESC
    LIMIT 1
  ) openact ON true
  -- How many times this user has redeemed it in total (open + closed).
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS use_count
    FROM public.coupon_activations ca2
    WHERE ca2.coupon_id = c.id AND ca2.user_id = auth.uid()
  ) counts ON true
  WHERE c.restaurant_id = p_restaurant_id
    AND c.is_deleted = false
    AND c.is_active = true
    AND c.expiry_date > NOW()
    -- Combined total still has room, UNLESS this user already has an open
    -- window (so they can still see/finish it even if the total just filled up).
    AND (c.usage_limit IS NULL OR c.times_used < c.usage_limit OR openact.activated_at IS NOT NULL)
    -- This user hasn't exhausted their own per-customer cap, with the same
    -- open-window exception.
    AND (COALESCE(counts.use_count, 0) < c.per_user_limit OR openact.activated_at IS NOT NULL)
  ORDER BY c.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_coupons_for_restaurant(UUID) TO authenticated;

-- ── 5. create_coupon / update_coupon / get_restaurant_coupons: surface the field ─
DROP FUNCTION IF EXISTS public.create_coupon(UUID, TEXT, NUMERIC, TEXT, TIMESTAMP WITH TIME ZONE, TEXT, INTEGER, JSONB);

CREATE FUNCTION public.create_coupon(
  p_restaurant_id UUID,
  p_coupon_type TEXT,
  p_discount_value NUMERIC,
  p_coupon_code TEXT,
  p_expiry_date TIMESTAMP WITH TIME ZONE,
  p_menu_item_id TEXT DEFAULT NULL,
  p_usage_limit INTEGER DEFAULT NULL,
  p_conditions JSONB DEFAULT NULL,
  p_per_user_limit INTEGER DEFAULT 1
)
RETURNS TABLE (
  coupon_id UUID,
  restaurant_id UUID,
  coupon_type TEXT,
  discount_value NUMERIC,
  menu_item_id TEXT,
  coupon_code TEXT,
  expiry_date TIMESTAMP WITH TIME ZONE,
  usage_limit INTEGER,
  times_used INTEGER,
  per_user_limit INTEGER,
  conditions JSONB,
  is_active BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.restaurants WHERE id = p_restaurant_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  IF v_owner_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to manage this restaurant';
  END IF;

  RETURN QUERY
  INSERT INTO public.coupons (
    restaurant_id, coupon_type, discount_value, menu_item_id,
    coupon_code, expiry_date, usage_limit, conditions, per_user_limit
  )
  VALUES (
    p_restaurant_id, p_coupon_type, p_discount_value, p_menu_item_id,
    p_coupon_code, p_expiry_date, p_usage_limit, p_conditions, COALESCE(p_per_user_limit, 1)
  )
  RETURNING
    coupons.id, coupons.restaurant_id, coupons.coupon_type, coupons.discount_value,
    coupons.menu_item_id, coupons.coupon_code, coupons.expiry_date, coupons.usage_limit,
    coupons.times_used, coupons.per_user_limit, coupons.conditions, coupons.is_active, coupons.created_at;
END;
$$;

DROP FUNCTION IF EXISTS public.update_coupon(UUID, TEXT, NUMERIC, TEXT, TIMESTAMP WITH TIME ZONE, TEXT, INTEGER, JSONB, BOOLEAN);

CREATE FUNCTION public.update_coupon(
  p_coupon_id UUID,
  p_coupon_type TEXT DEFAULT NULL,
  p_discount_value NUMERIC DEFAULT NULL,
  p_coupon_code TEXT DEFAULT NULL,
  p_expiry_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  p_menu_item_id TEXT DEFAULT NULL,
  p_usage_limit INTEGER DEFAULT NULL,
  p_conditions JSONB DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_per_user_limit INTEGER DEFAULT NULL
)
RETURNS TABLE (
  coupon_id UUID,
  restaurant_id UUID,
  coupon_type TEXT,
  discount_value NUMERIC,
  menu_item_id TEXT,
  coupon_code TEXT,
  expiry_date TIMESTAMP WITH TIME ZONE,
  usage_limit INTEGER,
  times_used INTEGER,
  per_user_limit INTEGER,
  conditions JSONB,
  is_active BOOLEAN,
  updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT r.owner_id INTO v_owner_id
  FROM public.coupons c
  JOIN public.restaurants r ON c.restaurant_id = r.id
  WHERE c.id = p_coupon_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Coupon not found';
  END IF;

  IF v_owner_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to update this coupon';
  END IF;

  RETURN QUERY
  UPDATE public.coupons
  SET
    coupon_type = COALESCE(p_coupon_type, public.coupons.coupon_type),
    discount_value = COALESCE(p_discount_value, public.coupons.discount_value),
    coupon_code = COALESCE(p_coupon_code, public.coupons.coupon_code),
    expiry_date = COALESCE(p_expiry_date, public.coupons.expiry_date),
    menu_item_id = COALESCE(p_menu_item_id, public.coupons.menu_item_id),
    usage_limit = COALESCE(p_usage_limit, public.coupons.usage_limit),
    conditions = COALESCE(p_conditions, public.coupons.conditions),
    is_active = COALESCE(p_is_active, public.coupons.is_active),
    per_user_limit = COALESCE(p_per_user_limit, public.coupons.per_user_limit),
    updated_at = NOW()
  WHERE public.coupons.id = p_coupon_id
  RETURNING
    coupons.id, coupons.restaurant_id, coupons.coupon_type, coupons.discount_value,
    coupons.menu_item_id, coupons.coupon_code, coupons.expiry_date, coupons.usage_limit,
    coupons.times_used, coupons.per_user_limit, coupons.conditions, coupons.is_active, coupons.updated_at;
END;
$$;

DROP FUNCTION IF EXISTS public.get_restaurant_coupons(UUID);

CREATE FUNCTION public.get_restaurant_coupons(p_restaurant_id UUID)
RETURNS TABLE (
  coupon_id UUID,
  coupon_type TEXT,
  discount_value NUMERIC,
  menu_item_id TEXT,
  coupon_code TEXT,
  expiry_date TIMESTAMP WITH TIME ZONE,
  usage_limit INTEGER,
  times_used INTEGER,
  per_user_limit INTEGER,
  conditions JSONB,
  is_active BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.restaurants WHERE id = p_restaurant_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  IF v_owner_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to view these coupons';
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.coupon_type, c.discount_value, c.menu_item_id, c.coupon_code,
    c.expiry_date, c.usage_limit, c.times_used, c.per_user_limit, c.conditions,
    c.is_active, c.created_at, c.updated_at
  FROM public.coupons c
  WHERE c.restaurant_id = p_restaurant_id
  ORDER BY c.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_coupon(UUID, TEXT, NUMERIC, TEXT, TIMESTAMP WITH TIME ZONE, TEXT, INTEGER, JSONB, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_coupon(UUID, TEXT, NUMERIC, TEXT, TIMESTAMP WITH TIME ZONE, TEXT, INTEGER, JSONB, BOOLEAN, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_restaurant_coupons(UUID) TO authenticated;

-- Migration: 022_coupon_activations
-- Purpose: Let a customer "activate" a coupon to get a time-boxed (5 min)
-- countdown screen to show restaurant staff, without any POS integration.
-- Activating burns one use from coupons.usage_limit immediately (idempotent -
-- re-activating an already-activated coupon just returns the same window).
-- Date: 2026-07-25

-- ─── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.coupon_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  closed_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT unique_activation_per_user_coupon UNIQUE (coupon_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_activations_user ON public.coupon_activations(user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_activations_coupon ON public.coupon_activations(coupon_id);

ALTER TABLE public.coupon_activations ENABLE ROW LEVEL SECURITY;

-- Reads are open to the owning user; all writes go through the SECURITY DEFINER
-- functions below so the atomic usage-limit check can't be bypassed by a direct
-- client insert/update.
CREATE POLICY "Users can view their own coupon activations"
  ON public.coupon_activations
  FOR SELECT
  USING (user_id = auth.uid());

COMMENT ON TABLE public.coupon_activations IS 'One row per (coupon, customer): tracks the 5-minute show-to-staff redemption window. A row existing means that customer already burned a use of the coupon; closed_at set means it should no longer be shown to them.';

-- ─── activate_coupon: burn a use, start the countdown ──────────────────────────

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
  v_claimed_id UUID;
  v_new RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Idempotent: reopening the countdown screen must never burn a second use.
  SELECT ca.activated_at, ca.expires_at INTO v_existing
  FROM public.coupon_activations ca
  WHERE ca.coupon_id = p_coupon_id AND ca.user_id = v_user_id;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.activated_at, v_existing.expires_at, true;
    RETURN;
  END IF;

  -- Atomically claim one use, only if the coupon is still valid and has room.
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

-- ─── close_coupon_activation: dismiss early (safe - use was already burned) ────

CREATE OR REPLACE FUNCTION public.close_coupon_activation(p_coupon_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rows INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.coupon_activations
  SET closed_at = NOW()
  WHERE coupon_id = p_coupon_id AND user_id = v_user_id AND closed_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- ─── get_active_coupons_for_restaurant: add activation state + fix usage_limit gap ─
-- Previously (migration 012) this never checked times_used against usage_limit,
-- so an exhausted coupon would still show as available forever. Also now excludes
-- a coupon this specific user already closed, while still surfacing their own
-- open (activated-but-not-closed) window so the countdown resumes on return.

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
    c.created_at,
    c.updated_at,
    ca.activated_at,
    ca.expires_at
  FROM public.coupons c
  LEFT JOIN public.coupon_activations ca
    ON ca.coupon_id = c.id AND ca.user_id = auth.uid()
  WHERE c.restaurant_id = p_restaurant_id
    AND c.is_deleted = false
    AND c.is_active = true
    AND c.expiry_date > NOW()
    AND (c.usage_limit IS NULL OR c.times_used < c.usage_limit OR ca.activated_at IS NOT NULL)
    AND ca.closed_at IS NULL
  ORDER BY c.created_at DESC;
END;
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────────

GRANT SELECT ON public.coupon_activations TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_coupon(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_coupon_activation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_coupons_for_restaurant(UUID) TO authenticated;

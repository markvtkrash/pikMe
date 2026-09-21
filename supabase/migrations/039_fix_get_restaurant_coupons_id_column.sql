-- Migration: 039_fix_get_restaurant_coupons_id_column
-- Purpose: get_restaurant_coupons has always returned each row's identifier
--          column named "coupon_id" (since its original definition in
--          migration 009), but every single owner-app consumer of this RPC
--          (dashboard.tsx, menu.tsx, expired.tsx, orphaned-coupons.tsx,
--          coupon/[id]/edit.tsx, active-coupons.tsx, inactive-coupons.tsx,
--          coupon-status.tsx) reads `coupon.id`, which has therefore always
--          been undefined. Concretely: every "Edit"/"Delete"/"Reassign"
--          action built on this RPC's results has been navigating to
--          `/restaurant/coupon/undefined/edit` or calling coupon RPCs with
--          `undefined` as the id — and every coupon row in a list shared the
--          same (undefined) React key. Renaming the returned column to "id"
--          fixes every consumer at once; nothing anywhere reads the old
--          "coupon_id" name off a get_restaurant_coupons row (verified —
--          only unrelated p_coupon_id RPC *parameters* exist).
-- Date: 2026-09-20

DROP FUNCTION IF EXISTS public.get_restaurant_coupons(UUID);

CREATE FUNCTION public.get_restaurant_coupons(p_restaurant_id UUID)
RETURNS TABLE (
  id UUID,
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

GRANT EXECUTE ON FUNCTION public.get_restaurant_coupons(UUID) TO authenticated;

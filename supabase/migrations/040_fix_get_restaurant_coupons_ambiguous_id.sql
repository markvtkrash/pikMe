-- Migration: 040_fix_get_restaurant_coupons_ambiguous_id
-- Purpose: 039 renamed get_restaurant_coupons's output column from
--          "coupon_id" to "id" to match every consumer's expectation — but
--          RETURNS TABLE column names become implicit PL/pgSQL variables
--          visible through the WHOLE function body, not just the RETURN
--          QUERY. That collided with the unqualified `id` in the ownership
--          check (`WHERE id = p_restaurant_id`), which was meant to mean
--          restaurants.id — Postgres couldn't tell which "id" was meant
--          ("column reference \"id\" is ambiguous", 42702). Qualifying that
--          reference fixes it without reverting the column rename from 039.
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
  SELECT r.owner_id INTO v_owner_id FROM public.restaurants r WHERE r.id = p_restaurant_id;

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

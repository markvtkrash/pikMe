-- Migration: 049_owner_top_coupons_report
-- Purpose: Last of the five owner reports -- Top Performing Coupons, scoped
--          to one restaurant and gated on ownership, same pattern as 048.
-- Date: 2026-09-22

CREATE OR REPLACE FUNCTION public.owner_report_top_coupons(p_restaurant_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  coupon_id UUID,
  coupon_code TEXT,
  coupon_type TEXT,
  discount_value NUMERIC,
  usage_limit INTEGER,
  times_used INTEGER,
  redemption_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.restaurants WHERE id = p_restaurant_id;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to view reports for this restaurant';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.coupon_code,
    c.coupon_type,
    c.discount_value,
    c.usage_limit,
    c.times_used,
    COUNT(ca.id) AS redemption_count
  FROM public.coupons c
  LEFT JOIN public.coupon_activations ca ON ca.coupon_id = c.id
  WHERE c.restaurant_id = p_restaurant_id AND c.is_deleted = false
  GROUP BY c.id, c.coupon_code, c.coupon_type, c.discount_value, c.usage_limit, c.times_used
  ORDER BY redemption_count DESC, c.times_used DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_report_top_coupons TO authenticated;

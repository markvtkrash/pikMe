-- Migration: 048_owner_reports
-- Purpose: Owner-facing reports (Redemptions Over Time, Coupon Status
--          Overview) for the new /restaurant/reports section. Same idea as
--          the admin reports (045/046) but scoped to a single restaurant and
--          gated on the caller actually owning it, not on an admin role.
-- Date: 2026-09-22

CREATE OR REPLACE FUNCTION public.owner_report_redemptions_over_time(p_restaurant_id UUID)
RETURNS TABLE (week_start DATE, redemption_count BIGINT)
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
    date_trunc('week', ca.activated_at)::date AS week_start,
    COUNT(*)
  FROM public.coupon_activations ca
  JOIN public.coupons c ON c.id = ca.coupon_id
  WHERE c.restaurant_id = p_restaurant_id
  GROUP BY 1
  ORDER BY 1 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_report_coupon_status_snapshot(p_restaurant_id UUID)
RETURNS TABLE (active_count BIGINT, inactive_count BIGINT, expired_count BIGINT, orphaned_count BIGINT)
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
    COUNT(*) FILTER (WHERE c.is_active = true AND c.expiry_date > NOW()),
    COUNT(*) FILTER (WHERE c.is_active = false),
    COUNT(*) FILTER (WHERE c.expiry_date <= NOW()),
    COUNT(*) FILTER (
      WHERE c.coupon_type IN ('item_percent', 'item_fixed')
        AND c.menu_item_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.item_id = c.menu_item_id)
    )
  FROM public.coupons c
  WHERE c.restaurant_id = p_restaurant_id AND c.is_deleted = false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_report_redemptions_over_time TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_report_coupon_status_snapshot TO authenticated;

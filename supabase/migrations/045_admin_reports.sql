-- Migration: 045_admin_reports
-- Purpose: Priority-1 admin reports -- growth/funnel and coupon
--          effectiveness. Each is a dedicated, admin-gated, read-only RPC
--          that does its own grouping/aggregation in SQL rather than pulling
--          raw rows to the client. Note: "active/inactive/expired/orphaned"
--          is reported as a CURRENT snapshot, not a historical trend -- there
--          is no periodic-snapshot table to trend it against, and orphaned
--          status in particular can't be reconstructed retroactively once a
--          menu item is gone.
-- Date: 2026-09-22

-- Shared admin-check pattern used by every function below.
CREATE OR REPLACE FUNCTION public._require_admin()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
END;
$$;

-- ── 1. Claims over time, by week + status ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_claims_over_time()
RETURNS TABLE (week_start DATE, status TEXT, claim_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    date_trunc('week', r.claimed_at)::date AS week_start,
    r.status,
    COUNT(*) AS claim_count
  FROM public.restaurants r
  GROUP BY 1, 2
  ORDER BY 1 DESC, 2;
END;
$$;

-- ── 2. Time from claim to admin approval ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_claim_approval_time()
RETURNS TABLE (approved_count BIGINT, avg_hours NUMERIC, median_hours NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    COUNT(*),
    ROUND(AVG(EXTRACT(EPOCH FROM (approved_at - claimed_at)) / 3600.0)::NUMERIC, 1),
    ROUND(
      (PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (approved_at - claimed_at)) / 3600.0
      ))::NUMERIC, 1
    )
  FROM public.restaurants
  WHERE status = 'approved' AND approved_at IS NOT NULL;
END;
$$;

-- ── 3. Restaurant status snapshot ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_restaurant_status_snapshot()
RETURNS TABLE (status TEXT, restaurant_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT r.status, COUNT(*)
  FROM public.restaurants r
  GROUP BY r.status
  ORDER BY COUNT(*) DESC;
END;
$$;

-- ── 4. Coupon redemptions over time, by week ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_redemptions_over_time()
RETURNS TABLE (week_start DATE, redemption_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    date_trunc('week', ca.activated_at)::date AS week_start,
    COUNT(*)
  FROM public.coupon_activations ca
  GROUP BY 1
  ORDER BY 1 DESC;
END;
$$;

-- ── 5. Current coupon status snapshot (active / inactive / expired / orphaned) ──
-- Independent, non-exclusive counts -- mirrors the same logic the owner-facing
-- Manage Coupons page uses (a coupon can be more than one of these at once).
CREATE OR REPLACE FUNCTION public.admin_report_coupon_status_snapshot()
RETURNS TABLE (active_count BIGINT, inactive_count BIGINT, expired_count BIGINT, orphaned_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

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
  WHERE c.is_deleted = false;
END;
$$;

-- ── 6. Top coupons by redemption count ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_top_coupons(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  coupon_id UUID,
  coupon_code TEXT,
  restaurant_name TEXT,
  coupon_type TEXT,
  discount_value NUMERIC,
  usage_limit INTEGER,
  times_used INTEGER,
  redemption_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    c.id,
    c.coupon_code,
    r.name,
    c.coupon_type,
    c.discount_value,
    c.usage_limit,
    c.times_used,
    COUNT(ca.id) AS redemption_count
  FROM public.coupons c
  JOIN public.restaurants r ON r.id = c.restaurant_id
  LEFT JOIN public.coupon_activations ca ON ca.coupon_id = c.id
  WHERE c.is_deleted = false
  GROUP BY c.id, c.coupon_code, r.name, c.coupon_type, c.discount_value, c.usage_limit, c.times_used
  ORDER BY redemption_count DESC, c.times_used DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_report_claims_over_time TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_claim_approval_time TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_restaurant_status_snapshot TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_redemptions_over_time TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_coupon_status_snapshot TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_top_coupons TO authenticated;

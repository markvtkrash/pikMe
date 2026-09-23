-- Migration: 046_admin_reports_priority2
-- Purpose: Priority-2 admin reports -- owner engagement, menu data health,
--          and support ticket operations. Same pattern as 045: dedicated,
--          admin-gated, read-only RPCs doing their own aggregation in SQL.
-- Date: 2026-09-22

-- ── 1. Owner active/inactive snapshot ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_owner_status_snapshot()
RETURNS TABLE (active_count BIGINT, inactive_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE ro.is_active = true),
    COUNT(*) FILTER (WHERE ro.is_active = false)
  FROM public.restaurant_owners ro;
END;
$$;

-- ── 2. Owners needing attention: approved but zero coupons and/or zero ──────
--      verified menu items -- an actionable follow-up list, not just a count.
CREATE OR REPLACE FUNCTION public.admin_report_owners_needing_attention()
RETURNS TABLE (
  owner_id UUID,
  business_name TEXT,
  email TEXT,
  restaurant_id UUID,
  restaurant_name TEXT,
  coupon_count BIGINT,
  verified_item_count BIGINT,
  zero_coupons BOOLEAN,
  zero_verified_items BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    ro.id,
    ro.business_name,
    ro.email,
    r.id,
    r.name,
    COALESCE(cc.coupon_count, 0),
    COALESCE(mc.verified_count, 0),
    COALESCE(cc.coupon_count, 0) = 0,
    COALESCE(mc.verified_count, 0) = 0
  FROM public.restaurant_owners ro
  JOIN public.restaurants r ON r.owner_id = ro.id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS coupon_count
    FROM public.coupons c
    WHERE c.restaurant_id = r.id AND c.is_deleted = false
  ) cc ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS verified_count
    FROM public.menu_items mi
    WHERE lower(trim(mi.restaurant_name)) = lower(trim(r.name)) AND mi.is_verified = true
  ) mc ON true
  WHERE r.status = 'approved'
    AND (COALESCE(cc.coupon_count, 0) = 0 OR COALESCE(mc.verified_count, 0) = 0)
  ORDER BY r.claimed_at ASC;
END;
$$;

-- ── 3. Menu data health snapshot (scoped to claimed restaurants) ────────────
CREATE OR REPLACE FUNCTION public.admin_report_menu_health_snapshot()
RETURNS TABLE (verified_count BIGINT, unverified_count BIGINT, restaurants_with_no_items_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.menu_items mi
     JOIN public.restaurants r ON lower(trim(mi.restaurant_name)) = lower(trim(r.name))
     WHERE mi.is_verified = true),
    (SELECT COUNT(*) FROM public.menu_items mi
     JOIN public.restaurants r ON lower(trim(mi.restaurant_name)) = lower(trim(r.name))
     WHERE mi.is_verified = false),
    (SELECT COUNT(*) FROM public.restaurants r
     WHERE r.status IN ('approved', 'pending')
       AND NOT EXISTS (
         SELECT 1 FROM public.menu_items mi
         WHERE lower(trim(mi.restaurant_name)) = lower(trim(r.name))
       ));
END;
$$;

-- ── 4. Restaurants with zero menu items (actionable list) ───────────────────
CREATE OR REPLACE FUNCTION public.admin_report_restaurants_no_menu_items()
RETURNS TABLE (restaurant_id UUID, restaurant_name TEXT, status TEXT, claimed_at TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT r.id, r.name, r.status, r.claimed_at
  FROM public.restaurants r
  WHERE r.status IN ('approved', 'pending')
    AND NOT EXISTS (
      SELECT 1 FROM public.menu_items mi
      WHERE lower(trim(mi.restaurant_name)) = lower(trim(r.name))
    )
  ORDER BY r.claimed_at ASC;
END;
$$;

-- ── 5. Support tickets: by status + submitter type, and resolution time ─────
CREATE OR REPLACE FUNCTION public.admin_report_support_snapshot()
RETURNS TABLE (
  ticket_type TEXT,
  status TEXT,
  ticket_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT st.ticket_type, st.status, COUNT(*)
  FROM public.support_tickets st
  GROUP BY st.ticket_type, st.status
  ORDER BY st.ticket_type, st.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_report_support_resolution_time()
RETURNS TABLE (resolved_count BIGINT, avg_hours NUMERIC, median_hours NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    COUNT(*),
    ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0)::NUMERIC, 1),
    ROUND(
      (PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0
      ))::NUMERIC, 1
    )
  FROM public.support_tickets
  WHERE resolved_at IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_report_owner_status_snapshot TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_owners_needing_attention TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_menu_health_snapshot TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_restaurants_no_menu_items TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_support_snapshot TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_support_resolution_time TO authenticated;

-- Migration: 047_menu_health_by_restaurant
-- Purpose: Fills a gap in the Priority-2 reports plan -- menu data health was
--          only built as an overall snapshot (046), not broken down per
--          restaurant as originally scoped. Adds that breakdown as its own
--          RPC so the Reports page can show a table instead of a single pair
--          of numbers.
-- Date: 2026-09-22

CREATE OR REPLACE FUNCTION public.admin_report_menu_health_by_restaurant()
RETURNS TABLE (
  restaurant_id UUID,
  restaurant_name TEXT,
  verified_count BIGINT,
  unverified_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    COUNT(*) FILTER (WHERE mi.is_verified = true),
    COUNT(*) FILTER (WHERE mi.is_verified = false)
  FROM public.restaurants r
  JOIN public.menu_items mi ON lower(trim(mi.restaurant_name)) = lower(trim(r.name))
  WHERE r.status IN ('approved', 'pending')
  GROUP BY r.id, r.name
  ORDER BY r.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_report_menu_health_by_restaurant TO authenticated;

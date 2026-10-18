-- Menu Data Health: fold the separate "No menu items at all" list into the main restaurant
-- table as a filter ("0 Menu Items") instead of its own section/RPC.
--
--   p_no_items   FALSE (default) = restaurants with at least one item, same as before;
--                TRUE = only restaurants with zero items.
--
-- admin_report_restaurants_no_menu_items is dropped -- its job is now p_no_items = TRUE on the
-- main function. Its own ordering (longest-neglected first: oldest claimed_at/found_at, NULLS
-- LAST) is kept for that case; the has-items case is unchanged (alphabetical) -- a single ORDER
-- BY handles both, since the "since" sort key evaluates to NULL (and so is ignored by NULLS
-- LAST) whenever p_no_items is false.
--
-- Safe to re-run.

DROP FUNCTION IF EXISTS public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_report_restaurants_no_menu_items(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_report_menu_health_by_restaurant(
  p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0,
  p_source TEXT DEFAULT NULL, p_franchise TEXT DEFAULT NULL, p_no_items BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  total_count      BIGINT,
  restaurant_id    UUID,
  restaurant_name  TEXT,
  verified_count   BIGINT,
  unverified_count BIGINT,
  place_id         TEXT,
  address          TEXT,
  is_franchise     BOOLEAN,
  source           TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT COUNT(*) OVER ()::BIGINT, h.mh_id, h.mh_name, h.mh_verified, h.mh_unverified, h.mh_place_id, h.mh_address, h.mh_franchise, h.mh_source
  FROM public._menu_health_rows(p_state, p_city, p_source, p_franchise) h
  WHERE CASE WHEN COALESCE(p_no_items, FALSE) THEN h.mh_verified + h.mh_unverified = 0 ELSE h.mh_verified + h.mh_unverified > 0 END
  ORDER BY (CASE WHEN COALESCE(p_no_items, FALSE) THEN h.mh_since END) ASC NULLS LAST, lower(h.mh_name), h.mh_place_id, h.mh_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

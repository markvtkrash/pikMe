-- The admin's "Upload menu" page for a restaurant nobody has claimed (/admin/menu-management/by-place) looked the place up only in the
-- Google cache (cached_restaurants). A place a customer opened that is not in that cache (for example one added by hand, or already
-- cleaned out of the cache) showed "restaurant not found" even though it was listed under Scheduled Builds.
--
--   admin_get_place_info(place_id)   the place's name and address for the admin: from the Google cache when it is there, else from the
--                                    customer's click record (name only), else from the menu items saved for it. NULL when nothing
--                                    anywhere knows the place. Admin only.
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.admin_get_place_info(p_place_id TEXT)
RETURNS TABLE (place_id TEXT, name TEXT, address TEXT, source TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT cr.place_id, cr.name, cr.address, 'cache'::TEXT
  FROM public.cached_restaurants cr WHERE cr.place_id = p_place_id
  UNION ALL
  SELECT k.place_id, k.restaurant_name, NULL::TEXT, 'click'::TEXT
  FROM public.place_menu_clicks k
  WHERE k.place_id = p_place_id
    AND NOT EXISTS (SELECT 1 FROM public.cached_restaurants x WHERE x.place_id = p_place_id)
  UNION ALL
  SELECT p_place_id, m.restaurant_name, NULL::TEXT, 'menu'::TEXT
  FROM public.menu_items m
  WHERE m.place_id = p_place_id
    AND NOT EXISTS (SELECT 1 FROM public.cached_restaurants x WHERE x.place_id = p_place_id)
    AND NOT EXISTS (SELECT 1 FROM public.place_menu_clicks y WHERE y.place_id = p_place_id)
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_place_info(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_place_info(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

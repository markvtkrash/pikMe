-- City Imports: see the restaurants a city found, and open their menus.
--
--   admin_list_crawl_city_places(city_id)   every restaurant the search returned for a city, with what became of it (queued for
--                                           the crawler, already had a menu, no website, franchise, closed), how the crawler's read
--                                           went (pending / crawling / done / no_items / error / needs_attention) and how many
--                                           dishes are stored for it. Admin only.
--   admin_get_place_info(place_id)          now also knows a city's restaurants (name and address), so the admin menu pages can open
--                                           one that is not in the Google cache and has no dishes yet. Order: the Google cache, the
--                                           city list, the customer's click record, the saved menu items.
--
-- Safe to re-run.

DROP FUNCTION IF EXISTS public.admin_list_crawl_city_places(UUID);

CREATE FUNCTION public.admin_list_crawl_city_places(p_city_id UUID)
RETURNS TABLE (
  place_id TEXT, name TEXT, address TEXT, website TEXT, outcome TEXT,
  crawl_status TEXT, crawl_detail TEXT, dish_count INTEGER, verified_count INTEGER, found_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT p.place_id, p.name, p.address, p.website, p.outcome,
         m.status, m.last_detail,
         (SELECT COUNT(*) FROM public.menu_items mi WHERE mi.place_id = p.place_id)::INTEGER,
         (SELECT COUNT(*) FROM public.menu_items mi WHERE mi.place_id = p.place_id AND mi.is_verified)::INTEGER,
         p.found_at
    FROM public.city_places p
    LEFT JOIN public.place_menu_crawl m ON m.place_id = p.place_id
   WHERE p.city_id = p_city_id
   ORDER BY CASE p.outcome WHEN 'queued' THEN 0 WHEN 'has_menu' THEN 1 ELSE 2 END, p.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_crawl_city_places(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_crawl_city_places(UUID) TO authenticated;

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
  SELECT cp.place_id, cp.name, cp.address, 'city'::TEXT
  FROM public.city_places cp
  WHERE cp.place_id = p_place_id
    AND NOT EXISTS (SELECT 1 FROM public.cached_restaurants x WHERE x.place_id = p_place_id)
  UNION ALL
  SELECT k.place_id, k.restaurant_name, NULL::TEXT, 'click'::TEXT
  FROM public.place_menu_clicks k
  WHERE k.place_id = p_place_id
    AND NOT EXISTS (SELECT 1 FROM public.cached_restaurants x WHERE x.place_id = p_place_id)
    AND NOT EXISTS (SELECT 1 FROM public.city_places y WHERE y.place_id = p_place_id)
  UNION ALL
  SELECT p_place_id, m.restaurant_name, NULL::TEXT, 'menu'::TEXT
  FROM public.menu_items m
  WHERE m.place_id = p_place_id
    AND NOT EXISTS (SELECT 1 FROM public.cached_restaurants x WHERE x.place_id = p_place_id)
    AND NOT EXISTS (SELECT 1 FROM public.city_places y WHERE y.place_id = p_place_id)
    AND NOT EXISTS (SELECT 1 FROM public.place_menu_clicks z WHERE z.place_id = p_place_id)
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_place_info(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_place_info(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

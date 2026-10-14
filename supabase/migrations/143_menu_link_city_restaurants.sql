-- Saving a menu link for a City Imports restaurant failed with "Restaurant not found".
--
-- admin_set_place_menu_link (migrations 121 / 122) looks up the restaurant's name in cached_restaurants (Google results customers have
-- browsed) and in restaurants (claimed ones). A restaurant found by a City Import is in neither: it lives in city_places (and in the
-- crawl and build queues), until a customer happens to browse it. So an admin fixing a failed City Imports link was told it did not exist.
--
-- The name is now looked up in this order: cached_restaurants, claimed restaurants, City Imports (city_places), the crawl record
-- (place_menu_crawl), the build queue (menu_build_queue). Everything else in the function is exactly as in migration 122.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.admin_set_place_menu_link(p_place_id TEXT, p_link TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link  TEXT := NULLIF(btrim(COALESCE(p_link, '')), '');
  v_name  TEXT;
  v_owner TEXT;
BEGIN
  PERFORM public._require_admin();

  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' THEN
    RAISE EXCEPTION 'That restaurant has no valid place ID';
  END IF;
  IF v_link IS NOT NULL AND (length(v_link) > 2000 OR v_link ~ '\s' OR v_link !~* '^https?://[^/?#\s]+\.[^/?#\s]+') THEN
    RAISE EXCEPTION 'The menu link must be a full web address starting with http:// or https://';
  END IF;

  SELECT COALESCE(
           (SELECT cr.name FROM public.cached_restaurants cr WHERE cr.place_id = p_place_id),
           (SELECT r.name FROM public.restaurants r WHERE r.google_place_id = p_place_id LIMIT 1),
           (SELECT cp.name FROM public.city_places cp WHERE cp.place_id = p_place_id ORDER BY cp.found_at DESC LIMIT 1),
           (SELECT c.restaurant_name FROM public.place_menu_crawl c WHERE c.place_id = p_place_id),
           (SELECT q.restaurant_name FROM public.menu_build_queue q WHERE q.kind = 'place' AND q.place_id = p_place_id LIMIT 1)
         ) INTO v_name;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;
  IF public.is_franchise_chain(v_name) THEN
    RAISE EXCEPTION 'A franchise has one shared menu: manage it in Franchise Menu Management';
  END IF;

  IF v_link IS NOT NULL THEN
    -- the triggers queue the crawl (source admin) and reset "did it work"
    INSERT INTO public.menu_build_queue (kind, place_id, restaurant_name, status, override_link)
    VALUES ('place', p_place_id, v_name, 'built', v_link)
    ON CONFLICT (place_id) WHERE kind = 'place' DO UPDATE
      SET override_link = EXCLUDED.override_link, restaurant_name = EXCLUDED.restaurant_name, updated_at = NOW();
    RETURN 'queued';
  END IF;

  -- remove the admin's link
  UPDATE public.menu_build_queue q SET override_link = NULL, updated_at = NOW()
  WHERE q.kind = 'place' AND q.place_id = p_place_id;

  -- only if the crawl record is the admin's: queue the owner's link instead, or drop the record
  IF EXISTS (SELECT 1 FROM public.place_menu_crawl c WHERE c.place_id = p_place_id AND c.link_source = 'admin') THEN
    SELECT NULLIF(btrim(r.menu_link), '') INTO v_owner FROM public.restaurants r WHERE r.google_place_id = p_place_id LIMIT 1;
    IF v_owner IS NOT NULL THEN
      PERFORM public.request_place_crawl(p_place_id, v_name, v_owner, 'owner');
    ELSE
      DELETE FROM public.place_menu_crawl c WHERE c.place_id = p_place_id AND c.link_source = 'admin';
    END IF;
  END IF;
  RETURN 'removed';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_place_menu_link(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_place_menu_link(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

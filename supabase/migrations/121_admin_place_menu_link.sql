-- An admin's menu link for one restaurant, set from the restaurant's Manage page (by its Google place ID).
--
--   admin_get_place_menu_link(place)      the link in force and where it came from, with the last read result:
--                                        the crawl table first, else an admin link, else the owner's profile link.
--   admin_set_place_menu_link(place, link)  saves the admin's link (it wins over the owner's and over one found online)
--                                        and queues the restaurant for the browser crawler. A blank link removes the
--                                        admin's link: the owner's link is queued instead if there is one, otherwise
--                                        the crawl record is dropped (the next customer click looks for a link again).
--
-- The admin link is stored as the override link on the restaurant's queue row (the same place migration 107 and the
-- crawler already read), and the trigger from migration 114 queues the crawl. Franchises are refused (one shared menu).
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.admin_get_place_menu_link(p_place_id TEXT)
RETURNS TABLE (link TEXT, source TEXT, status TEXT, detail TEXT, finished_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_link TEXT;
  v_owner_link TEXT;
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT c.link, c.link_source, c.status, c.last_detail, c.finished_at
  FROM public.place_menu_crawl c WHERE c.place_id = p_place_id;
  IF FOUND THEN RETURN; END IF;

  SELECT NULLIF(btrim(q.override_link), '') INTO v_admin_link
  FROM public.menu_build_queue q WHERE q.kind = 'place' AND q.place_id = p_place_id;
  IF v_admin_link IS NOT NULL THEN
    RETURN QUERY SELECT v_admin_link, 'admin'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT NULLIF(btrim(r.menu_link), '') INTO v_owner_link
  FROM public.restaurants r WHERE r.google_place_id = p_place_id LIMIT 1;
  IF v_owner_link IS NOT NULL THEN
    RETURN QUERY SELECT v_owner_link, 'owner'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_place_menu_link(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_place_menu_link(TEXT) TO authenticated;

-- Returns 'queued' (the link was saved and will be read at the crawler's next run) or 'removed'.
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
           (SELECT r.name FROM public.restaurants r WHERE r.google_place_id = p_place_id LIMIT 1)
         ) INTO v_name;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;
  IF public.is_franchise_chain(v_name) THEN
    RAISE EXCEPTION 'A franchise has one shared menu: manage it in Franchise Menu Management';
  END IF;

  IF v_link IS NOT NULL THEN
    -- the trigger on override_link queues the crawl (source admin)
    INSERT INTO public.menu_build_queue (kind, place_id, restaurant_name, status, override_link)
    VALUES ('place', p_place_id, v_name, 'built', v_link)
    ON CONFLICT (place_id) WHERE kind = 'place' DO UPDATE
      SET override_link = EXCLUDED.override_link, restaurant_name = EXCLUDED.restaurant_name, updated_at = NOW();
    RETURN 'queued';
  END IF;

  -- remove the admin's link
  UPDATE public.menu_build_queue q SET override_link = NULL, updated_at = NOW()
  WHERE q.kind = 'place' AND q.place_id = p_place_id;

  SELECT NULLIF(btrim(r.menu_link), '') INTO v_owner FROM public.restaurants r WHERE r.google_place_id = p_place_id LIMIT 1;
  IF v_owner IS NOT NULL THEN
    PERFORM public.request_place_crawl(p_place_id, v_name, v_owner, 'owner');
  ELSE
    DELETE FROM public.place_menu_crawl c WHERE c.place_id = p_place_id AND c.link_source = 'admin';
  END IF;
  RETURN 'removed';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_place_menu_link(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_place_menu_link(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- get_place_share_info: a single-row, read-only lookup by place_id for the new public share page
-- (mkrash-web /r/[placeId]) that a shared restaurant/dish text message links to. Public (anon-granted) --
-- same shape as the other anon-granted read functions in this codebase (get_menu_items_for_restaurant,
-- restaurant_is_listed, get_customer_config): SECURITY DEFINER, REVOKE ALL FROM PUBLIC, GRANT to anon.
--
-- Never calls Google: only reads public.restaurants / public.cached_restaurants. A place_id that isn't
-- already cached or claimed simply returns no rows, so there is nothing to rate-limit beyond the cost of
-- a cheap indexed SELECT.
--
-- Respects listing visibility: a claimed restaurant that is paused/closed/rejected must not leak through
-- here just because its row still exists -- reuses restaurant_is_listed() (migration 139) as the gate,
-- the same way the rest of the app already does.
--
-- Safe to re-run.
CREATE OR REPLACE FUNCTION public.get_place_share_info(p_place_id TEXT)
RETURNS TABLE (name TEXT, address TEXT, cuisine_types TEXT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_place_id IS NULL OR btrim(p_place_id) = '' THEN RETURN; END IF;

  -- A claimed, currently-listed restaurant's own info wins; a paused/closed/rejected one
  -- must not leak through here just because the row still exists.
  IF public.restaurant_is_listed(p_place_id) THEN
    RETURN QUERY SELECT r.name, r.address, r.cuisines
      FROM public.restaurants r WHERE r.google_place_id = p_place_id LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Otherwise the Google-sourced cache. Never calls Google itself -- an unknown place_id
  -- simply returns no rows.
  RETURN QUERY SELECT cr.name, cr.address, cr.cuisine_types
    FROM public.cached_restaurants cr WHERE cr.place_id = p_place_id LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_place_share_info(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_place_share_info(TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

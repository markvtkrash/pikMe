-- find_chain_place_id (081), improved in two ways.
--
-- 1. It also looks at CLAIMED restaurants. It used to search only
--    cached_restaurants (stores customers' searches have seen). An admin who
--    creates a restaurant owner for a chain location (Create Owner page)
--    registers that store's Google place ID on the claimed restaurant
--    (restaurants.google_place_id), which is NOT copied into cached_restaurants,
--    so the "Pull menu now" button could not find it. This searches both and
--    returns the most recently seen match. The name rule is unchanged: the same
--    exact match on the normalized name or an alias that is_franchise_chain uses.
--
-- 2. It runs with its owner's permissions (SECURITY DEFINER). It is called by the
--    get-chain-menu edge function as the service role, which on this database was
--    refused with "permission denied for table cached_restaurants" (42501): row
--    security is bypassed by that role but table privileges are not. Running as the
--    owner means the lookup no longer depends on which tables that role was granted.
--    Only the service role may EXECUTE it, and it returns just a place ID.
--
-- The grants at the end also give the service role read access to the two tables,
-- for anything else that needs it. Safe to re-run.
CREATE OR REPLACE FUNCTION public.find_chain_place_id(p_chain_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.place_id
  FROM (
    SELECT cr.place_id, cr.cached_at AS seen_at
    FROM public.franchise_chains fc
    JOIN public.cached_restaurants cr
      ON public.normalize_restaurant_name(cr.name) = fc.normalized_name
      OR EXISTS (
        SELECT 1 FROM unnest(fc.aliases) a
        WHERE public.normalize_restaurant_name(a) = public.normalize_restaurant_name(cr.name)
      )
    WHERE fc.id = p_chain_id
      AND cr.place_id IS NOT NULL

    UNION ALL

    SELECT r.google_place_id AS place_id, r.created_at AS seen_at
    FROM public.franchise_chains fc
    JOIN public.restaurants r
      ON public.normalize_restaurant_name(r.name) = fc.normalized_name
      OR EXISTS (
        SELECT 1 FROM unnest(fc.aliases) a
        WHERE public.normalize_restaurant_name(a) = public.normalize_restaurant_name(r.name)
      )
    WHERE fc.id = p_chain_id
      AND r.google_place_id IS NOT NULL
  ) s
  ORDER BY s.seen_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_chain_place_id(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_chain_place_id(UUID) TO service_role;

GRANT SELECT ON public.cached_restaurants TO service_role;
GRANT SELECT ON public.restaurants TO service_role;

NOTIFY pgrst, 'reload schema';

-- A Google place ID for any known store of a chain, used by the admin "Pull menu
-- now" button when the chain has no stored lookup yet (the SerpApi lookup needs
-- one real store's place ID). Looks in cached_restaurants for a store whose name
-- matches the chain by the same exact rule as is_franchise_chain. Returns NULL
-- when no store of the chain has been seen yet. Called only by the get-chain-menu
-- edge function (service role). Safe to re-run.
CREATE OR REPLACE FUNCTION public.find_chain_place_id(p_chain_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT cr.place_id
  FROM public.franchise_chains fc
  JOIN public.cached_restaurants cr
    ON public.normalize_restaurant_name(cr.name) = fc.normalized_name
    OR EXISTS (
      SELECT 1 FROM unnest(fc.aliases) a
      WHERE public.normalize_restaurant_name(a) = public.normalize_restaurant_name(cr.name)
    )
  WHERE fc.id = p_chain_id
    AND cr.place_id IS NOT NULL
  ORDER BY cr.cached_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_chain_place_id(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_chain_place_id(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

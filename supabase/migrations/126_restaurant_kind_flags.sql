-- Two admin switches (Config Management) for which kinds of restaurants the customer site shows:
--
--   showFranchiseRestaurants    'true' (default) shows franchise restaurants; 'false' hides every franchise restaurant.
--   showIndependentRestaurants  'true' (default) shows independent restaurants; 'false' hides every independent.
--
-- A hidden kind is left out of the Explore list, the Coupons Only filter, the chat's restaurant list and every other place the
-- customer app lists nearby restaurants. A missing or unreadable flag counts as 'true' (nothing is hidden). An admin's value
-- is kept when this migration is re-run.
--
--   franchise_names_among(names)  which of the given restaurant names are franchises (the same check as is_franchise_chain),
--                                 answered in one call so a list of restaurants needs one lookup, not one per restaurant.
--
-- Safe to re-run.

INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('showFranchiseRestaurants', 'true', 'Consumer app: show franchise (chain) restaurants. OFF = every franchise restaurant is hidden from the customer site (Explore, Coupons Only, chat).', 'Consumer app: no .env equivalent, DB-only'),
  ('showIndependentRestaurants', 'true', 'Consumer app: show independent restaurants. OFF = every independent restaurant is hidden from the customer site (Explore, Coupons Only, chat).', 'Consumer app: no .env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

CREATE OR REPLACE FUNCTION public.franchise_names_among(p_names TEXT[])
RETURNS TABLE (name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.name
  FROM (SELECT DISTINCT btrim(x) AS name FROM unnest(p_names[1:500]) AS x) n
  WHERE n.name <> '' AND public.is_franchise_chain(n.name);
$$;

REVOKE ALL ON FUNCTION public.franchise_names_among(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.franchise_names_among(TEXT[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

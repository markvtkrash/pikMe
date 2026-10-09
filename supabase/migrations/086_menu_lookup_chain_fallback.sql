-- Consumer menu lookup: fall back to the chain's menu when the store's own name
-- has no template rows.
--
-- get_menu_items_for_restaurant (067) matched the template by EXACT name, so a
-- store Google calls "Taco Bell #123" or "Taco Bell Cantina" never found the menu
-- pulled under the chain name "Taco Bell". Now, in the template branch only:
--   1. rows stored under the exact name win, as before (any row, even if all
--      are out of stock, so an emptied menu stays empty);
--   2. otherwise, if the name belongs to an active chain (find_franchise_chain:
--      normalized name or alias), use that chain's template rows.
-- The location-own-menu branch is untouched. Read-only, still SECURITY INVOKER;
-- find_franchise_chain and franchise_chains are already readable by anon.
CREATE OR REPLACE FUNCTION public.get_menu_items_for_restaurant(
  p_place_id TEXT,
  p_restaurant_name TEXT
)
RETURNS SETOF public.menu_items
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_chain_name TEXT;
BEGIN
  IF p_place_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.menu_items mi WHERE mi.place_id = p_place_id
  ) THEN
    RETURN QUERY
    SELECT mi.*
    FROM public.menu_items mi
    WHERE mi.place_id = p_place_id
      AND mi.is_out_of_stock = FALSE;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.place_id IS NULL AND mi.restaurant_name = p_restaurant_name
  ) THEN
    SELECT c.name INTO v_chain_name FROM public.find_franchise_chain(p_restaurant_name) c;
    IF v_chain_name IS NOT NULL THEN
      p_restaurant_name := v_chain_name;
    END IF;
  END IF;

  RETURN QUERY
  SELECT mi.*
  FROM public.menu_items mi
  WHERE mi.place_id IS NULL
    AND mi.restaurant_name = p_restaurant_name
    AND mi.is_out_of_stock = FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_items_for_restaurant(TEXT, TEXT) TO anon, authenticated;

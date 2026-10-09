-- Helpers for the get-chain-menu edge function (chain menus built from SerpApi
-- + the chain's own menu page). Safe to re-run.

-- ── 1. Which chain is this restaurant? ──────────────────────────────────────
-- Same matching rule as is_franchise_chain (exact match on the normalized
-- name or one of its aliases, active chains only) but returns the chain row so
-- the caller can key the menu on the chain instead of an individual store's
-- name. An exact-name match wins over an alias match.
CREATE OR REPLACE FUNCTION public.find_franchise_chain(p_name TEXT)
RETURNS TABLE (id UUID, name TEXT, normalized_name TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT fc.id, fc.name, fc.normalized_name
  FROM public.franchise_chains fc
  WHERE fc.is_active
    AND public.normalize_restaurant_name(p_name) <> ''
    AND (
      fc.normalized_name = public.normalize_restaurant_name(p_name)
      OR EXISTS (
        SELECT 1 FROM unnest(fc.aliases) a
        WHERE public.normalize_restaurant_name(a) = public.normalize_restaurant_name(p_name)
      )
    )
  ORDER BY (fc.normalized_name = public.normalize_restaurant_name(p_name)) DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.find_franchise_chain(TEXT) TO anon, authenticated, service_role;

-- ── 2. Replace a chain's AI-guessed menu with the real one ──────────────────
-- Called by the edge function (service role only) after it extracted a chain's
-- menu. Inserts the new items as the shared template (place_id NULL) for the
-- chain, unverified because the nutrition is AI-estimated even though the item
-- NAMES come from the chain's own page.
--
-- Before inserting it removes the chain's old AI-generated rows ('ai_%' ids from
-- fetch-menu-items-ai) and its previous chain-sourced rows ('chain_%'), so a
-- refresh replaces instead of piling up. It never touches:
--   * verified rows (anything an owner or admin entered),
--   * per-location rows (place_id set),
--   * any item a user has saved. saved_menu_items cascades on delete (see 030),
--     so deleting a saved item would silently remove it from that user's list.
-- Returns the number of items inserted.
CREATE OR REPLACE FUNCTION public.replace_chain_menu_items(
  p_chain_name TEXT,
  p_items      JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_chain_name IS NULL OR btrim(p_chain_name) = '' THEN
    RAISE EXCEPTION 'chain name is required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array';
  END IF;

  DELETE FROM public.menu_items mi
  WHERE mi.restaurant_name = p_chain_name
    AND mi.place_id IS NULL
    AND COALESCE(mi.is_verified, false) = false
    AND (mi.item_id LIKE 'ai\_%' ESCAPE '\' OR mi.item_id LIKE 'chain\_%' ESCAPE '\')
    AND NOT EXISTS (SELECT 1 FROM public.saved_menu_items s WHERE s.item_id = mi.item_id);

  INSERT INTO public.menu_items (
    item_id, restaurant_name, name, serving_weight_grams, calories,
    total_fat_g, saturated_fat_g, sodium_mg, total_carbs_g,
    dietary_fiber_g, sugars_g, protein_g, image_url, is_verified, cached_at
  )
  SELECT
    i->>'itemId', p_chain_name, i->>'name', (i->>'servingWeightGrams')::NUMERIC,
    (i->>'calories')::INT, (i->>'totalFat_g')::NUMERIC, (i->>'saturatedFat_g')::NUMERIC,
    (i->>'sodium_mg')::INT, (i->>'totalCarbs_g')::NUMERIC,
    (i->>'dietaryFiber_g')::NUMERIC, (i->>'sugars_g')::NUMERIC,
    (i->>'protein_g')::NUMERIC, NULL, false, NOW()
  FROM jsonb_array_elements(p_items) AS i
  ON CONFLICT (item_id) DO UPDATE SET
    calories = EXCLUDED.calories,
    total_fat_g = EXCLUDED.total_fat_g,
    saturated_fat_g = EXCLUDED.saturated_fat_g,
    sodium_mg = EXCLUDED.sodium_mg,
    total_carbs_g = EXCLUDED.total_carbs_g,
    dietary_fiber_g = EXCLUDED.dietary_fiber_g,
    sugars_g = EXCLUDED.sugars_g,
    protein_g = EXCLUDED.protein_g,
    cached_at = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Deletes rows and writes menu data: only the edge function (service role) may call it.
REVOKE ALL ON FUNCTION public.replace_chain_menu_items(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_chain_menu_items(TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

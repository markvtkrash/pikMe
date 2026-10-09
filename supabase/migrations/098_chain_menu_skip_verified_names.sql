-- A chain build no longer adds a dish whose name already exists as a VERIFIED item for that chain.
--
-- Photo, text and hand-entered items are verified and live under the restaurant's name (the same name as the
-- chain's when they are the same), but they get a different item id than a pulled item, so the same dish
-- appeared twice after a pull. The photo upload already skips a dish whose name is already there; this makes
-- the chain build do the same for verified items, so a verified item always wins over the AI-estimated copy.
--
-- Matching is the same as the photo upload's: the dish name, ignoring case and surrounding spaces, and the
-- restaurant name ignoring case. Only shared (template) rows count: a single store's own menu (place_id set) is
-- a separate menu and does not hide a chain dish. Everything else is unchanged from migration 073: the same
-- delete rules (old unverified ai_/chain_ rows that nobody saved), the same insert/update by item id, the same
-- return value (how many items were inserted or updated), now excluding the skipped ones.
-- Safe to re-run.
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
  WHERE NOT EXISTS (
    SELECT 1 FROM public.menu_items v
    WHERE lower(v.restaurant_name) = lower(p_chain_name)
      AND v.place_id IS NULL
      AND COALESCE(v.is_verified, false) = true
      AND lower(btrim(v.name)) = lower(btrim(i->>'name'))
  )
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

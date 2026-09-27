-- Lets an owner override AI-estimated nutrition with real values they
-- actually know (recipe costing, supplier spec sheet, etc.), entered in
-- bulk via a pasted list matched against existing menu item names — see
-- owner app's "Add Nutrition Info" page. Items updated this way are marked
-- nutrition_source = 'owner_provided' so the consumer app can stop showing
-- the "AI estimate" disclaimer specifically for those.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS nutrition_source TEXT NOT NULL DEFAULT 'ai_estimate'
    CHECK (nutrition_source IN ('ai_estimate', 'owner_provided'));

-- Partial update by name match (only the fields present in each update are
-- touched — anything omitted keeps its current AI-estimated value) rather
-- than a full replace, since this is meant to enrich a subset of an
-- already-populated menu, not recreate it. Exact (case/whitespace-
-- normalized) name match on both restaurant_name and item name, matching
-- the convention fixed elsewhere in this codebase (migration 043 and the
-- restaurant_name scoping fix) — no first-word wildcard, no fuzzy partial
-- match, since silently updating the wrong dish's nutrition would be worse
-- than just not matching it.
CREATE OR REPLACE FUNCTION public.update_menu_item_nutrition(
  p_restaurant_id UUID,
  p_updates JSONB
)
RETURNS TABLE (name TEXT, matched BOOLEAN) AS $$
DECLARE
  v_restaurant_name TEXT;
  v_is_owner        BOOLEAN;
  v_is_admin        BOOLEAN;
  v_update          JSONB;
  v_updated_count   INT;
BEGIN
  SELECT r.name, (r.owner_id = auth.uid())
    INTO v_restaurant_name, v_is_owner
    FROM public.restaurants r
    WHERE r.id = p_restaurant_id;

  IF v_restaurant_name IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT (COALESCE(v_is_owner, FALSE) OR COALESCE(v_is_admin, FALSE)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  FOR v_update IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE public.menu_items m
    SET
      calories         = COALESCE((v_update->>'calories')::INT, m.calories),
      protein_g        = COALESCE((v_update->>'protein_g')::NUMERIC, m.protein_g),
      total_carbs_g    = COALESCE((v_update->>'totalCarbs_g')::NUMERIC, m.total_carbs_g),
      total_fat_g      = COALESCE((v_update->>'totalFat_g')::NUMERIC, m.total_fat_g),
      sodium_mg        = COALESCE((v_update->>'sodium_mg')::INT, m.sodium_mg),
      nutrition_source = 'owner_provided'
    WHERE lower(trim(m.restaurant_name)) = lower(trim(v_restaurant_name))
      AND lower(trim(m.name)) = lower(trim(v_update->>'name'));

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    name := v_update->>'name';
    matched := v_updated_count > 0;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

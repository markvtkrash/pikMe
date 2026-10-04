-- PikMe does not collect or use religious preference data.
--
-- The app no longer offers Halal / Kosher / Hindu Meal, and the AI onboarding
-- no longer extracts them. This migration closes the database side:
--   1. is_religious_dietary_value / strip_religious_dietary: one place that
--      defines what counts as a religious dietary value.
--   2. upsert_user_profile drops such values before storing, so an old app
--      build (or a direct API call) can't save them.
--   3. get_user_profile never returns them, so values already stored for
--      existing users are not used (recommendations, warnings, AI prompts,
--      the chat tab) even though the rows may still exist.
--   4. filter_menu_items_for_user loses its halal clause.
--
-- This migration does NOT delete rows that are already stored. Purging them is
-- a separate, deliberate step (see 069 if/when it is added).
--
-- Keep the pattern in sync with user/src/utils/religiousData.ts and the copies
-- in the ai-onboard / ai-chat / ai-item-analysis edge functions.

-- ── 1. Definition ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_religious_dietary_value(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    p_value ~* '(halal|kosher|hindu|jain|buddh|muslim|islam|jewish|christian|sikh|religio|ramadan|sabbath)',
    false
  );
$$;

-- Keeps the original order, drops religious values and NULLs, never returns NULL.
CREATE OR REPLACE FUNCTION public.strip_religious_dietary(p_values TEXT[])
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(t.v ORDER BY t.ord), '{}'::TEXT[])
  FROM unnest(COALESCE(p_values, '{}'::TEXT[])) WITH ORDINALITY AS t(v, ord)
  WHERE t.v IS NOT NULL
    AND NOT public.is_religious_dietary_value(t.v);
$$;

GRANT EXECUTE ON FUNCTION public.is_religious_dietary_value(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.strip_religious_dietary(TEXT[]) TO anon, authenticated;

-- ── 2. Never store them ──────────────────────────────────────────────────────
-- Same as the version in 002, except dietary restrictions pass through
-- strip_religious_dietary.
CREATE OR REPLACE FUNCTION public.upsert_user_profile(
  p_display_name         TEXT,
  p_dietary_restrictions TEXT[],
  p_health_goals         TEXT[],
  p_allergens            TEXT[],
  p_cuisine_preferences  TEXT[],
  p_nutrition_targets    JSONB,
  p_search_radius_meters INT,
  p_onboarding_complete  BOOLEAN
) RETURNS VOID AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  INSERT INTO public.user_profiles (id, display_name, search_radius_meters, onboarding_complete)
    VALUES (v_user_id, p_display_name, p_search_radius_meters, p_onboarding_complete)
    ON CONFLICT (id) DO UPDATE SET
      display_name         = EXCLUDED.display_name,
      search_radius_meters = EXCLUDED.search_radius_meters,
      onboarding_complete  = EXCLUDED.onboarding_complete,
      updated_at           = NOW();

  DELETE FROM public.user_dietary_restrictions WHERE user_id = v_user_id;
  INSERT INTO public.user_dietary_restrictions (user_id, value)
    SELECT v_user_id, unnest(public.strip_religious_dietary(p_dietary_restrictions));

  DELETE FROM public.user_health_goals WHERE user_id = v_user_id;
  INSERT INTO public.user_health_goals (user_id, value)
    SELECT v_user_id, unnest(p_health_goals);

  DELETE FROM public.user_allergens WHERE user_id = v_user_id;
  INSERT INTO public.user_allergens (user_id, allergen)
    SELECT v_user_id, unnest(p_allergens);

  DELETE FROM public.user_cuisine_preferences WHERE user_id = v_user_id;
  INSERT INTO public.user_cuisine_preferences (user_id, value)
    SELECT v_user_id, unnest(p_cuisine_preferences);

  INSERT INTO public.user_nutrition_targets (
    user_id, daily_calories, max_meal_calories, max_carbs_g,
    max_sodium_mg, min_protein_g, max_saturated_fat_g
  ) VALUES (
    v_user_id,
    (p_nutrition_targets->>'dailyCalories')::INT,
    (p_nutrition_targets->>'maxMealCalories')::INT,
    (p_nutrition_targets->>'maxCarbs_g')::INT,
    (p_nutrition_targets->>'maxSodium_mg')::INT,
    (p_nutrition_targets->>'minProtein_g')::INT,
    (p_nutrition_targets->>'maxSaturatedFat_g')::INT
  )
  ON CONFLICT (user_id) DO UPDATE SET
    daily_calories      = EXCLUDED.daily_calories,
    max_meal_calories   = EXCLUDED.max_meal_calories,
    max_carbs_g         = EXCLUDED.max_carbs_g,
    max_sodium_mg       = EXCLUDED.max_sodium_mg,
    min_protein_g       = EXCLUDED.min_protein_g,
    max_saturated_fat_g = EXCLUDED.max_saturated_fat_g;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. Never return them (covers values stored before this migration) ────────
CREATE OR REPLACE FUNCTION public.get_user_profile()
RETURNS JSONB AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'id',                   p.id,
      'displayName',          p.display_name,
      'searchRadiusMeters',   p.search_radius_meters,
      'onboardingComplete',   p.onboarding_complete,
      'dietaryRestrictions',  COALESCE((SELECT jsonb_agg(value) FROM public.user_dietary_restrictions WHERE user_id = v_user_id AND NOT public.is_religious_dietary_value(value)), '[]'),
      'healthGoals',          COALESCE((SELECT jsonb_agg(value) FROM public.user_health_goals WHERE user_id = v_user_id), '[]'),
      'allergens',            COALESCE((SELECT jsonb_agg(allergen) FROM public.user_allergens WHERE user_id = v_user_id), '[]'),
      'cuisinePreferences',   COALESCE((SELECT jsonb_agg(value) FROM public.user_cuisine_preferences WHERE user_id = v_user_id), '[]'),
      'nutritionTargets',     COALESCE((SELECT row_to_json(t) FROM public.user_nutrition_targets t WHERE user_id = v_user_id), '{}')
    )
    FROM public.user_profiles p WHERE p.id = v_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4. No halal clause in the menu filter ────────────────────────────────────
DROP FUNCTION IF EXISTS public.filter_menu_items_for_user(TEXT[]);
CREATE OR REPLACE FUNCTION public.filter_menu_items_for_user(p_item_ids TEXT[])
RETURNS TABLE (item_id TEXT) AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_restrictions TEXT[];
  v_allergens  TEXT[];
  v_max_cal    INT;
BEGIN
  SELECT ARRAY(SELECT value FROM public.user_dietary_restrictions WHERE user_id = v_user_id)
    INTO v_restrictions;
  SELECT ARRAY(SELECT allergen FROM public.user_allergens WHERE user_id = v_user_id)
    INTO v_allergens;
  SELECT max_meal_calories * 1.5 FROM public.user_nutrition_targets WHERE user_id = v_user_id
    INTO v_max_cal;

  RETURN QUERY
  SELECT m.item_id FROM public.menu_items m
  WHERE m.item_id = ANY(p_item_ids)
    AND (v_max_cal IS NULL OR m.calories <= v_max_cal)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(v_allergens) AS a
      WHERE lower(m.name) LIKE '%' || lower(a) || '%'
    )
    AND (NOT ('vegan' = ANY(v_restrictions)) OR
         NOT (lower(m.name) ~ 'chicken|beef|pork|fish|shrimp|turkey|bacon|ham|lamb|dairy|cheese|butter|milk|egg'))
    AND (NOT ('vegetarian' = ANY(v_restrictions)) OR
         NOT (lower(m.name) ~ 'chicken|beef|pork|fish|shrimp|turkey|bacon|ham|lamb'))
    AND (NOT ('gluten_free' = ANY(v_restrictions)) OR
         NOT (lower(m.name) ~ 'bread|pasta|bun|wrap|tortilla|wheat|flour|sandwich|sub|burger'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.filter_menu_items_for_user(TEXT[]) TO authenticated;

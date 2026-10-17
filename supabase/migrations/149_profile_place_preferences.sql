-- The profile's choices now use the SAME category list as the Explore filters and the owner's three questions ("What is your place", "How can
-- customers get food", "What do you serve"): restaurant_categories (migration 129), managed by an admin.
--
--   user_venue_preferences      kinds of place the person likes (category keys of the group "venue")
--   user_service_preferences    how they like to get food (category keys of the group "service")
--   user_cuisine_preferences    already existed; its values are now category keys of the group "cuisine"
--
--   _profile_cuisine_key(v)         an old profile cuisine ("korean") or a category key as the category key it counts as ("asian"); NULL when it is
--                                   not a cuisine category (it is then left out). Only clear matches are converted: korean and vietnamese become asian,
--                                   greek and middle_eastern become mediterranean; the keys that are already categories stay as they are.
--   migrate_profile_cuisines()      converts the stored cuisine values with that rule, drops what does not match, removes repeats. Run once below.
--   upsert_user_profile             two new arguments (venue, service; NULL leaves what is stored alone, so an older app keeps working). Every list is
--                                   checked against the category list: an unknown key is not stored.
--   get_user_profile                also returns venuePreferences and servicePreferences.
-- Needs migration 129 (the category list).

-- ── 1. Tables ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_venue_preferences (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  value   TEXT NOT NULL,
  UNIQUE (user_id, value)
);

CREATE TABLE IF NOT EXISTS public.user_service_preferences (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  value   TEXT NOT NULL,
  UNIQUE (user_id, value)
);

-- Spelled out, not left to the database's default privileges (which are not the same on every server): the edge functions use the service role, and a
-- signed-in person's access is limited to their own rows by the policies below.
GRANT ALL ON public.user_venue_preferences TO authenticated, service_role;
GRANT ALL ON public.user_service_preferences TO authenticated, service_role;

ALTER TABLE public.user_venue_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_service_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own venue preferences" ON public.user_venue_preferences;
DROP POLICY IF EXISTS "Users manage own service preferences" ON public.user_service_preferences;
CREATE POLICY "Users manage own venue preferences" ON public.user_venue_preferences FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own service preferences" ON public.user_service_preferences FOR ALL USING (auth.uid() = user_id);

-- ── 2. Old cuisine values to category keys ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._profile_cuisine_key(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.key
  FROM public.restaurant_categories c
  WHERE c.grp = 'cuisine'
    AND c.key = CASE lower(btrim(COALESCE(p_value, '')))
                  WHEN 'korean' THEN 'asian'
                  WHEN 'vietnamese' THEN 'asian'
                  WHEN 'greek' THEN 'mediterranean'
                  WHEN 'middle_eastern' THEN 'mediterranean'
                  ELSE lower(btrim(COALESCE(p_value, '')))
                END
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public._profile_cuisine_key(TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.migrate_profile_cuisines()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed INTEGER;
BEGIN
  -- rows that are no cuisine category (and have no clear conversion) are removed
  DELETE FROM public.user_cuisine_preferences p WHERE public._profile_cuisine_key(p.value) IS NULL;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  -- the others become the category they count as (korean -> asian)
  UPDATE public.user_cuisine_preferences p SET value = public._profile_cuisine_key(p.value) WHERE p.value <> public._profile_cuisine_key(p.value);

  -- two old values that became one (korean and vietnamese both asian): keep one row
  DELETE FROM public.user_cuisine_preferences a USING public.user_cuisine_preferences b
    WHERE a.user_id = b.user_id AND a.value = b.value AND a.id > b.id;

  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.migrate_profile_cuisines() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_profile_cuisines() TO service_role;

SELECT public.migrate_profile_cuisines();

-- ── 3. Saving and reading the profile ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.upsert_user_profile(TEXT, TEXT[], TEXT[], TEXT[], TEXT[], JSONB, INT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.upsert_user_profile(
  p_display_name         TEXT,
  p_dietary_restrictions TEXT[],
  p_health_goals         TEXT[],
  p_allergens            TEXT[],
  p_cuisine_preferences  TEXT[],
  p_nutrition_targets    JSONB,
  p_search_radius_meters INT,
  p_onboarding_complete  BOOLEAN,
  p_venue_preferences    TEXT[] DEFAULT NULL,
  p_service_preferences  TEXT[] DEFAULT NULL
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

  -- cuisines: an older app may still send "korean"; it is stored as the category it counts as, and a value that is no category is left out
  DELETE FROM public.user_cuisine_preferences WHERE user_id = v_user_id;
  INSERT INTO public.user_cuisine_preferences (user_id, value)
    SELECT DISTINCT v_user_id, public._profile_cuisine_key(v) FROM unnest(COALESCE(p_cuisine_preferences, ARRAY[]::TEXT[])) AS v
    WHERE public._profile_cuisine_key(v) IS NOT NULL;

  -- places and ways to get food: only when sent (an older app sends neither, and its stored choices stay)
  IF p_venue_preferences IS NOT NULL THEN
    DELETE FROM public.user_venue_preferences WHERE user_id = v_user_id;
    INSERT INTO public.user_venue_preferences (user_id, value)
      SELECT DISTINCT v_user_id, c.key FROM public.restaurant_categories c
      WHERE c.grp = 'venue' AND c.key = ANY (p_venue_preferences);
  END IF;
  IF p_service_preferences IS NOT NULL THEN
    DELETE FROM public.user_service_preferences WHERE user_id = v_user_id;
    INSERT INTO public.user_service_preferences (user_id, value)
      SELECT DISTINCT v_user_id, c.key FROM public.restaurant_categories c
      WHERE c.grp = 'service' AND c.key = ANY (p_service_preferences);
  END IF;

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
      'venuePreferences',     COALESCE((SELECT jsonb_agg(value) FROM public.user_venue_preferences WHERE user_id = v_user_id), '[]'),
      'servicePreferences',   COALESCE((SELECT jsonb_agg(value) FROM public.user_service_preferences WHERE user_id = v_user_id), '[]'),
      'nutritionTargets',     COALESCE((SELECT row_to_json(t) FROM public.user_nutrition_targets t WHERE user_id = v_user_id), '{}')
    )
    FROM public.user_profiles p WHERE p.id = v_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

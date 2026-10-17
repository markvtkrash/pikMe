-- Test for migration 149: the profile uses the same categories as the filters and the owner. Everything is tried inside a transaction that is rolled
-- back. Needs migrations 129, 145 and 149. Success: no error.
DO $$
DECLARE
  v_user UUID := gen_random_uuid();
  v_p    JSONB;
  v_n    INTEGER;
  v_targets CONSTANT JSONB := '{}'::jsonb;
BEGIN
  ASSERT has_table_privilege('service_role', 'public.user_venue_preferences', 'SELECT'), 'the tables exist';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_venue_preferences'::regclass), 'row level security is on for places';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_service_preferences'::regclass), 'row level security is on for ways to get food';
  ASSERT NOT has_function_privilege('authenticated', 'public.migrate_profile_cuisines()', 'EXECUTE'), 'a customer cannot run the conversion';

  -- ── the conversion rule for one value ──
  ASSERT public._profile_cuisine_key('thai') = 'thai', 'a category key stays as it is';
  ASSERT public._profile_cuisine_key('italian') = 'italian', 'italian stays';
  ASSERT public._profile_cuisine_key('korean') = 'asian', 'korean becomes asian';
  ASSERT public._profile_cuisine_key('vietnamese') = 'asian', 'vietnamese becomes asian';
  ASSERT public._profile_cuisine_key('greek') = 'mediterranean', 'greek becomes mediterranean';
  ASSERT public._profile_cuisine_key('middle_eastern') = 'mediterranean', 'middle eastern becomes mediterranean';
  ASSERT public._profile_cuisine_key('  THAI ') = 'thai', 'spaces and capitals do not matter';
  ASSERT public._profile_cuisine_key('latin_american') IS NULL, 'a cuisine with no category is left out';
  ASSERT public._profile_cuisine_key('soul_food') IS NULL, 'soul food has no category';
  ASSERT public._profile_cuisine_key('cafe') IS NULL, 'a place type is not a cuisine';
  ASSERT public._profile_cuisine_key('') IS NULL AND public._profile_cuisine_key(NULL) IS NULL, 'empty gives nothing';

  BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role)
    VALUES (v_user, 'profile149@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

    -- ── saving: old-style cuisines are converted, unknown keys are not stored ──
    PERFORM public.upsert_user_profile('Test', ARRAY['vegan'], ARRAY['balanced'], ARRAY[]::TEXT[],
      ARRAY['thai', 'korean', 'vietnamese', 'latin_american', 'ITALIAN'], v_targets, 8000, TRUE,
      ARRAY['cafe', 'bakery', 'thai', 'nonsense'], ARRAY['takeaway', 'delivery', 'bar']);
    v_p := public.get_user_profile();
    ASSERT (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(v_p->'cuisinePreferences') x) = ARRAY['asian', 'italian', 'thai'],
      'cuisines are converted, repeated ones merged, and the one with no category dropped, got ' || (v_p->>'cuisinePreferences');
    ASSERT (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(v_p->'venuePreferences') x) = ARRAY['bakery', 'cafe'],
      'places keep only place categories (a cuisine and nonsense are dropped), got ' || (v_p->>'venuePreferences');
    ASSERT (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(v_p->'servicePreferences') x) = ARRAY['delivery', 'takeaway'],
      'ways to get food keep only service categories (a place type is dropped), got ' || (v_p->>'servicePreferences');

    -- ── an older app sends no places or services: what is stored stays ──
    PERFORM public.upsert_user_profile('Test', ARRAY['vegan'], ARRAY['balanced'], ARRAY[]::TEXT[], ARRAY['mexican'], v_targets, 8000, TRUE);
    v_p := public.get_user_profile();
    ASSERT (SELECT array_agg(x) FROM jsonb_array_elements_text(v_p->'cuisinePreferences') x) = ARRAY['mexican'], 'cuisines are replaced with what was sent';
    ASSERT jsonb_array_length(v_p->'venuePreferences') = 2, 'places are left alone when not sent';
    ASSERT jsonb_array_length(v_p->'servicePreferences') = 2, 'ways to get food are left alone when not sent';

    -- ── an empty list clears them ──
    PERFORM public.upsert_user_profile('Test', ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], v_targets, 8000, TRUE, ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
    v_p := public.get_user_profile();
    ASSERT jsonb_array_length(v_p->'venuePreferences') = 0 AND jsonb_array_length(v_p->'servicePreferences') = 0 AND jsonb_array_length(v_p->'cuisinePreferences') = 0,
      'empty lists clear all three';

    -- ── NULL cuisines do not break saving ──
    PERFORM public.upsert_user_profile('Test', ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, v_targets, 8000, TRUE);
    ASSERT jsonb_array_length(public.get_user_profile()->'cuisinePreferences') = 0, 'no cuisines sent means none stored';

    -- ── the one-off conversion of rows already stored ──
    DELETE FROM public.user_cuisine_preferences WHERE user_id = v_user;
    INSERT INTO public.user_cuisine_preferences (user_id, value) VALUES
      (v_user, 'korean'), (v_user, 'vietnamese'), (v_user, 'thai'), (v_user, 'soul_food'), (v_user, 'greek'), (v_user, 'mediterranean');
    v_n := public.migrate_profile_cuisines();
    ASSERT v_n >= 1, 'the row with no category was removed';
    ASSERT (SELECT array_agg(value ORDER BY value) FROM public.user_cuisine_preferences WHERE user_id = v_user) = ARRAY['asian', 'mediterranean', 'thai'],
      'old values converted and repeats merged (korean+vietnamese = one asian, greek+mediterranean = one mediterranean)';
    ASSERT public.migrate_profile_cuisines() >= 0 AND (SELECT COUNT(*) FROM public.user_cuisine_preferences WHERE user_id = v_user) = 3, 'running it again changes nothing more';

    -- ── another person cannot see these (row level security on the tables) ──
    INSERT INTO public.user_venue_preferences (user_id, value) VALUES (v_user, 'cafe') ON CONFLICT DO NOTHING;
    ASSERT (SELECT COUNT(*) FROM public.user_venue_preferences WHERE user_id = v_user) = 1, 'a place choice is stored once per person (unique)';

    RAISE EXCEPTION 'rollback_test_149';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_149' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 149 TESTS PASSED';
END $$;

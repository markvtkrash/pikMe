-- Test for migration 129: restaurant categories (place type, ways to order, cuisine). Wiring and access come from the catalog;
-- the behaviour is tried inside a transaction that is rolled back, so nothing is left behind. Needs migrations 128 and 129.
-- Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_rest  public.restaurants%ROWTYPE;
  v_json  JSONB;
BEGIN
  -- seed and access
  ASSERT (SELECT COUNT(*) FROM public.restaurant_categories WHERE grp = 'venue') >= 8, 'the place types are seeded';
  ASSERT (SELECT COUNT(*) FROM public.restaurant_categories WHERE grp = 'service') >= 4, 'the ways to order are seeded';
  ASSERT (SELECT COUNT(*) FROM public.restaurant_categories WHERE grp = 'cuisine') >= 10, 'the cuisines are seeded';
  ASSERT NOT has_table_privilege('anon', 'public.restaurant_categories', 'SELECT'), 'the table is not readable directly';
  ASSERT NOT has_table_privilege('authenticated', 'public.restaurant_category_map', 'SELECT'), 'nor the mapping';
  ASSERT has_function_privilege('anon', 'public.get_restaurant_categories()', 'EXECUTE'), 'the categories are readable before sign-in';
  ASSERT has_function_privilege('authenticated', 'public.categorize_google_types(text[])', 'EXECUTE'), 'owners can ask for Google''s guess';
  ASSERT NOT has_function_privilege('anon', 'public.admin_save_restaurant_category(text,text,text,integer,boolean)', 'EXECUTE'), 'anon cannot edit categories';
  ASSERT NOT has_function_privilege('anon', 'public.admin_set_restaurant_categories(uuid,text[],text[],text[])', 'EXECUTE'), 'anon cannot edit a restaurant';

  -- Google's guess: each type goes to its own group, a place keeps all of them
  ASSERT (SELECT COUNT(*) FROM public.categorize_google_types(ARRAY['cafe', 'meal_takeaway', 'meal_delivery', 'mediterranean_restaurant'])) = 4,
    'a cafe with takeaway, delivery and a cuisine is four categories';
  ASSERT EXISTS (SELECT 1 FROM public.categorize_google_types(ARRAY['cafe', 'meal_takeaway']) WHERE key = 'cafe' AND grp = 'venue'), 'cafe is a place type';
  ASSERT EXISTS (SELECT 1 FROM public.categorize_google_types(ARRAY['cafe', 'meal_takeaway']) WHERE key = 'takeaway' AND grp = 'service'), 'takeaway is a way to order';
  ASSERT EXISTS (SELECT 1 FROM public.categorize_google_types(ARRAY['pizza_restaurant']) WHERE key = 'italian' AND grp = 'cuisine'), 'pizza is Italian';
  ASSERT NOT EXISTS (SELECT 1 FROM public.categorize_google_types(ARRAY['food', 'point_of_interest', 'establishment'])  WHERE grp <> 'venue'),
    'unknown Google types are ignored';
  ASSERT (SELECT key FROM public.categorize_google_types(ARRAY['food'])) = 'restaurant', 'no place type found means Restaurant';
  ASSERT (SELECT key FROM public.categorize_google_types(NULL)) = 'restaurant', 'no types at all means Restaurant';
  ASSERT NOT EXISTS (SELECT 1 FROM public.categorize_google_types(ARRAY['bar']) WHERE key = 'restaurant'), 'a bar is not also a Restaurant';

  -- the customer's one call carries the categories
  v_json := public.get_customer_config('1.0.0');
  ASSERT jsonb_typeof(v_json -> 'categories') = 'array' AND jsonb_array_length(v_json -> 'categories') >= 20, 'the categories ride along';
  ASSERT v_json ? 'announcements' AND v_json ? 'minAppVersion', 'the older fields are still there';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  SELECT * INTO v_rest FROM public.restaurants r WHERE r.status = 'approved' ORDER BY r.created_at LIMIT 1;
  IF v_admin IS NULL OR v_rest.id IS NULL THEN
    RAISE NOTICE 'no admin or restaurant to try the behaviour on; wiring checks only';
    RAISE NOTICE 'ALL 129 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    -- an admin sets a restaurant's categories; a NULL group resets to Google's guess
    PERFORM public.admin_set_restaurant_categories(v_rest.id, ARRAY['cafe', 'bakery'], ARRAY['takeaway'], NULL);
    SELECT * INTO v_rest FROM public.restaurants r WHERE r.id = v_rest.id;
    ASSERT v_rest.venue_types = ARRAY['cafe', 'bakery'] AND v_rest.services = ARRAY['takeaway'] AND v_rest.cuisines IS NULL, 'the choices are saved';
    v_json := public.admin_get_restaurant_categories(v_rest.id);
    ASSERT v_json -> 'venue_types' = '["cafe","bakery"]'::jsonb AND jsonb_typeof(v_json -> 'cuisines') = 'null', 'and read back, with an unset group as null';
    ASSERT v_json ? 'google_guess' AND v_json ? 'google_types', 'with Google''s guess beside them';
    PERFORM public.admin_set_restaurant_categories(v_rest.id, NULL, NULL, NULL);
    ASSERT (SELECT venue_types FROM public.restaurants WHERE id = v_rest.id) IS NULL, 'a reset goes back to Google''s guess';
    -- "none" for ways to order and cuisine is a real answer
    PERFORM public.admin_set_restaurant_categories(v_rest.id, ARRAY['bar'], ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
    ASSERT (SELECT services FROM public.restaurants WHERE id = v_rest.id) = ARRAY[]::TEXT[], 'an empty list is kept as none';

    -- every write path is checked by the trigger
    BEGIN
      UPDATE public.restaurants SET venue_types = ARRAY[]::TEXT[] WHERE id = v_rest.id;
      RAISE EXCEPTION 'an empty place type list was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'an empty place type list was accepted' THEN RAISE; END IF; END;
    BEGIN
      UPDATE public.restaurants SET venue_types = ARRAY['takeaway'] WHERE id = v_rest.id;
      RAISE EXCEPTION 'a way to order was accepted as a place type';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a way to order was accepted as a place type' THEN RAISE; END IF; END;
    BEGIN
      UPDATE public.restaurants SET cuisines = ARRAY['italian', 'italian'] WHERE id = v_rest.id;
      RAISE EXCEPTION 'a repeated cuisine was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a repeated cuisine was accepted' THEN RAISE; END IF; END;
    BEGIN
      UPDATE public.restaurants SET services = ARRAY['teleport'] WHERE id = v_rest.id;
      RAISE EXCEPTION 'an unknown way to order was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'an unknown way to order was accepted' THEN RAISE; END IF; END;

    -- the admin's category page
    PERFORM public.admin_save_restaurant_category('brewery', 'venue', 'Brewery', 35, TRUE);
    v_json := public.admin_list_restaurant_categories();
    ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_json -> 'categories') c WHERE c ->> 'key' = 'brewery' AND c ->> 'label' = 'Brewery'), 'a new category is listed';
    PERFORM public.admin_set_category_mapping('brewery', 'brewery', TRUE);
    ASSERT EXISTS (SELECT 1 FROM public.categorize_google_types(ARRAY['brewery']) WHERE key = 'brewery'), 'a mapping takes effect at once';
    PERFORM public.admin_set_category_mapping('brewery', 'brewery', FALSE);
    ASSERT NOT EXISTS (SELECT 1 FROM public.categorize_google_types(ARRAY['brewery']) WHERE key = 'brewery'), 'and can be removed';
    PERFORM public.admin_save_restaurant_category('brewery', 'venue', 'Brewery', 35, FALSE);
    ASSERT NOT EXISTS (SELECT 1 FROM public.get_restaurant_categories() WHERE key = 'brewery'), 'a switched-off category is not offered';
    BEGIN
      PERFORM public.admin_save_restaurant_category('brewery', 'cuisine', 'Brewery', 35, TRUE);
      RAISE EXCEPTION 'a category moved to another group';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a category moved to another group' THEN RAISE; END IF; END;
    BEGIN
      PERFORM public.admin_save_restaurant_category('Bad Key!', 'venue', 'X', 1, TRUE);
      RAISE EXCEPTION 'a bad key was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a bad key was accepted' THEN RAISE; END IF; END;

    -- a non-admin cannot use the admin functions
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    BEGIN
      PERFORM public.admin_list_restaurant_categories();
      RAISE EXCEPTION 'a non-admin was allowed';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a non-admin was allowed' THEN RAISE; END IF; END;

    RAISE EXCEPTION 'rollback_test_129';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_129' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 129 TESTS PASSED';
END $$;

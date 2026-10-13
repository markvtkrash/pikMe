-- Test for migration 135: the admin's list of a city's restaurants, and the place info fallback to it. Wiring and access come from
-- the catalog; the behaviour is tried inside a transaction that is rolled back. Needs migrations 131, 134 and 135. Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_city  UUID;
  v_a CONSTANT TEXT := 'ChIJcity135aaaaaaaaa';
  v_b CONSTANT TEXT := 'ChIJcity135bbbbbbbbb';
  v_c CONSTANT TEXT := 'ChIJcity135ccccccccc';
  v_row   RECORD;
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_crawl_city_places(uuid)', 'EXECUTE'), 'anon cannot list a city''s restaurants';
  ASSERT has_function_privilege('authenticated', 'public.admin_list_crawl_city_places(uuid)', 'EXECUTE'), 'the page can call it (admin is checked inside)';
  ASSERT NOT has_function_privilege('anon', 'public.admin_get_place_info(text)', 'EXECUTE'), 'anon cannot read place info';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user to try the behaviour with; wiring checks only';
    RAISE NOTICE 'ALL 135 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    INSERT INTO public.crawl_cities (name, region, max_restaurants) VALUES ('Listville', 'TX', 10) RETURNING id INTO v_city;
    INSERT INTO public.city_places (city_id, place_id, name, address, website, outcome) VALUES
      (v_city, v_c, 'Zed Diner',   '9 Elm St, Listville, TX', NULL,                      'no_website'),
      (v_city, v_b, 'Beta Bistro', '2 Elm St, Listville, TX', 'https://beta.example.com', 'queued'),
      (v_city, v_a, 'Alpha Cafe',  '1 Elm St, Listville, TX', 'https://alpha.example.com', 'queued');
    INSERT INTO public.place_menu_crawl (place_id, restaurant_name, link, link_source, status, last_detail)
    VALUES (v_a, 'Alpha Cafe', 'https://alpha.example.com', 'city', 'done', '12 added');
    INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, is_out_of_stock, place_id) VALUES
      ('t135-1', 'Alpha Cafe', 'Soup', TRUE, FALSE, v_a),
      ('t135-2', 'Alpha Cafe', 'Salad', FALSE, FALSE, v_a);

    -- the list: queued ones first (by name), the rest after; each with its read status and dish counts
    ASSERT (SELECT COUNT(*) FROM public.admin_list_crawl_city_places(v_city)) = 3, 'all three are listed';
    ASSERT (SELECT array_agg(name ORDER BY ord) FROM (SELECT name, ROW_NUMBER() OVER () AS ord FROM public.admin_list_crawl_city_places(v_city)) s)
           = ARRAY['Alpha Cafe', 'Beta Bistro', 'Zed Diner'], 'queued restaurants come first, then the others, each by name';
    SELECT * INTO v_row FROM public.admin_list_crawl_city_places(v_city) WHERE place_id = v_a;
    ASSERT v_row.crawl_status = 'done' AND v_row.crawl_detail = '12 added', 'the read result is shown';
    ASSERT v_row.dish_count = 2 AND v_row.verified_count = 1, 'the dishes and the verified ones are counted';
    SELECT * INTO v_row FROM public.admin_list_crawl_city_places(v_city) WHERE place_id = v_b;
    ASSERT v_row.crawl_status IS NULL AND v_row.dish_count = 0, 'a restaurant not read yet has no status and no dishes';
    ASSERT (SELECT COUNT(*) FROM public.admin_list_crawl_city_places('00000000-0000-0000-0000-000000000000')) = 0, 'an unknown city lists nothing';

    -- place info: a city restaurant with no dishes is still found, with its address; one with dishes prefers the city's richer record
    SELECT * INTO v_row FROM public.admin_get_place_info(v_b);
    ASSERT v_row.name = 'Beta Bistro' AND v_row.address = '2 Elm St, Listville, TX' AND v_row.source = 'city', 'a city restaurant is found by its place id';
    SELECT * INTO v_row FROM public.admin_get_place_info(v_a);
    ASSERT v_row.name = 'Alpha Cafe' AND v_row.address IS NOT NULL AND v_row.source = 'city', 'the city record (with address) wins over the saved dishes';
    ASSERT NOT EXISTS (SELECT 1 FROM public.admin_get_place_info('ChIJcity135unknownxx')), 'an unknown place is still not found';

    -- anyone who is not an admin is refused
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    BEGIN
      PERFORM public.admin_list_crawl_city_places(v_city);
      ASSERT FALSE, 'a non-admin must be refused';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'rollback_test_135';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_135' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 135 TESTS PASSED';
END $$;

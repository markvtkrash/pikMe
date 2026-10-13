-- Test for migration 136: city and state for Menu Management. The address reading and the state names are pure functions; the list is
-- tried inside a transaction that is rolled back. Needs migrations 108, 134 and 136. Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_city  UUID;
  v_row   RECORD;
  v_a CONSTANT TEXT := 'ChIJcity136aaaaaaaaa';
  v_b CONSTANT TEXT := 'ChIJcity136bbbbbbbbb';
  v_c CONSTANT TEXT := 'ChIJcity136ccccccccc';
BEGIN
  -- reading a US address
  ASSERT public.address_city('1 Main St, Austin, TX 78701, USA') = 'Austin', 'the city of a full address';
  ASSERT public.address_state('1 Main St, Austin, TX 78701, USA') = 'TX', 'the state of a full address';
  ASSERT public.address_city('Austin, TX, USA') = 'Austin' AND public.address_state('Austin, TX, USA') = 'TX', 'a city-only address';
  ASSERT public.address_city('9 Elm Rd, St. Louis, MO 63101-1234') = 'St. Louis', 'a ZIP+4 and no country';
  ASSERT public.address_state('9 Elm Rd, St. Louis, MO') = 'MO', 'no ZIP and no country';
  ASSERT public.address_state('1 Main St, austin, tx 78701, USA') = 'TX', 'the state is upper-cased';
  ASSERT public.address_city('  1 Main St ,  Austin ,  TX 78701 , USA ') = 'Austin', 'spaces are trimmed';
  ASSERT public.address_city('12 Rue Cler, 75007 Paris, France') IS NULL AND public.address_state('12 Rue Cler, 75007 Paris, France') IS NULL, 'another country gives nothing';
  ASSERT public.address_state('Somewhere') IS NULL AND public.address_state('') IS NULL AND public.address_state(NULL) IS NULL, 'no usable address gives nothing';
  ASSERT public.address_city('Main St 5, TX 78701, USA') IS NULL AND public.address_state('Main St 5, TX 78701, USA') = 'TX', 'a street in the city position is not taken as the city';

  -- state names
  ASSERT public.normalize_state('Texas') = 'TX' AND public.normalize_state('  new   york ') = 'NY', 'a full name becomes its code';
  ASSERT public.normalize_state('tx') = 'TX', 'a code is upper-cased';
  ASSERT public.normalize_state('District of Columbia') = 'DC', 'the District of Columbia';
  ASSERT public.normalize_state('Ontario') = 'Ontario', 'anything else is kept as typed';
  ASSERT public.normalize_state(' ') IS NULL AND public.normalize_state(NULL) IS NULL, 'blank gives nothing';

  ASSERT NOT has_function_privilege('anon', 'public.admin_list_restaurants_with_menu_counts()', 'EXECUTE'), 'anon cannot list';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user to try the list with; function checks only';
    RAISE NOTICE 'ALL 136 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    INSERT INTO public.crawl_cities (name, region, max_restaurants) VALUES ('Listville', 'Texas', 10) RETURNING id INTO v_city;
    INSERT INTO public.city_places (city_id, place_id, name, address, website, outcome) VALUES
      (v_city, v_a, 'Alpha Cafe136',  '1 Elm St, Listville, TX 70001, USA', 'https://a.example.com', 'queued'),
      (v_city, v_b, 'Beta Bistro136', NULL,                                 'https://b.example.com', 'has_menu'),
      (v_city, v_c, 'Zed Diner136',   '9 Elm St, Listville, TX',            NULL,                    'no_website');

    SELECT * INTO v_row FROM public.admin_list_restaurants_with_menu_counts() WHERE place_id = v_a;
    ASSERT v_row.source = 'city' AND v_row.restaurant_name = 'Alpha Cafe136', 'a queued city restaurant is listed with source city';
    ASSERT v_row.city = 'Listville' AND v_row.state = 'TX', 'with the city and the state code from City Imports';
    ASSERT v_row.is_franchise IS FALSE AND v_row.total_items = 0, 'it is an independent with no dishes yet';
    ASSERT EXISTS (SELECT 1 FROM public.admin_list_restaurants_with_menu_counts() WHERE place_id = v_b AND source = 'city'), 'one that already had a menu is listed too';
    ASSERT NOT EXISTS (SELECT 1 FROM public.admin_list_restaurants_with_menu_counts() WHERE place_id = v_c), 'one left out (no website) is not listed';

    -- one that is already cached is listed once, as cached, with the city and state from its address
    INSERT INTO public.cached_restaurants (place_id, name, address) VALUES (v_a, 'Alpha Cafe136', '1 Elm St, Listville, TX 70001, USA');
    ASSERT (SELECT COUNT(*) FROM public.admin_list_restaurants_with_menu_counts() WHERE place_id = v_a) = 1, 'a restaurant that is cached and found by a city is listed once';
    SELECT * INTO v_row FROM public.admin_list_restaurants_with_menu_counts() WHERE place_id = v_a;
    ASSERT v_row.source = 'cached' AND v_row.city = 'Listville' AND v_row.state = 'TX', 'as cached, with the city and state read from its address';

    -- anyone who is not an admin is refused
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    BEGIN
      PERFORM * FROM public.admin_list_restaurants_with_menu_counts();
      ASSERT FALSE, 'a non-admin must be refused';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'rollback_test_136';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_136' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 136 TESTS PASSED';
END $$;

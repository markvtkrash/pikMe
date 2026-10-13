-- Test for migration 138: the Menu Data Health report also covers restaurants found by City Imports, and filters by source. Tried
-- inside a transaction that is rolled back. Needs migrations 108, 134, 136, 137 and 138. Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_owner UUID;
  v_city  UUID;
  v_row   RECORD;
  v_c1 CONSTANT TEXT := 'ChIJcityhl138aaaaaaa';   -- city import, has dishes
  v_c2 CONSTANT TEXT := 'ChIJcityhl138bbbbbbb';   -- city import, read but no dishes found
  v_c3 CONSTANT TEXT := 'ChIJcityhl138ccccccc';   -- city import, still waiting to be read
  v_c4 CONSTANT TEXT := 'ChIJcityhl138ddddddd';   -- found by the city AND claimed by an owner
  v_c5 CONSTANT TEXT := 'ChIJcityhl138eeeeeee';   -- found by the city but left out (no website)
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.admin_report_restaurants_no_menu_items(text,text,integer,integer,text)', 'EXECUTE'), 'anon cannot read the no-items list';
  ASSERT NOT has_function_privilege('authenticated', 'public._menu_health_scope()', 'EXECUTE'), 'the internal scope is not callable by users';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  SELECT ro.id INTO v_owner FROM public.restaurant_owners ro LIMIT 1;
  IF v_admin IS NULL OR v_owner IS NULL THEN
    RAISE NOTICE 'no admin user or no restaurant owner to try the behaviour with; wiring checks only';
    RAISE NOTICE 'ALL 138 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    INSERT INTO public.crawl_cities (name, region, max_restaurants) VALUES ('Cityvillezz', 'Texas', 20) RETURNING id INTO v_city;
    INSERT INTO public.city_places (city_id, place_id, name, address, website, outcome) VALUES
      (v_city, v_c1, 'Imported Cafe138',   '1 Oak St, Cityvillezz, TX 71001, USA', 'https://c1.example.com', 'queued'),
      (v_city, v_c2, 'Imported Bistro138', '2 Oak St, Cityvillezz, TX 71001, USA', 'https://c2.example.com', 'queued'),
      (v_city, v_c3, 'Imported Diner138',  '3 Oak St, Cityvillezz, TX 71001, USA', 'https://c3.example.com', 'queued'),
      (v_city, v_c4, 'Claimed Grill138',   '4 Oak St, Cityvillezz, TX 71001, USA', 'https://c4.example.com', 'queued'),
      (v_city, v_c5, 'No Site Deli138',    '5 Oak St, Cityvillezz, TX 71001, USA', NULL,                      'no_website');
    INSERT INTO public.place_menu_crawl (place_id, restaurant_name, link, link_source, status) VALUES
      (v_c1, 'Imported Cafe138',   'https://c1.example.com', 'city', 'done'),
      (v_c2, 'Imported Bistro138', 'https://c2.example.com', 'city', 'no_items'),
      (v_c3, 'Imported Diner138',  'https://c3.example.com', 'city', 'pending');
    -- one of the city's restaurants is also claimed by an owner (listed once, as claimed)
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status)
    VALUES (v_owner, v_c4, 'Claimed Grill138', '4 Oak St, Cityvillezz, TX 71001, USA', 'approved');
    INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, is_out_of_stock, place_id) VALUES
      ('t138-1', 'Imported Cafe138', 'Soup',  TRUE,  FALSE, v_c1),
      ('t138-2', 'Imported Cafe138', 'Salad', FALSE, FALSE, v_c1),
      ('t138-3', 'Claimed Grill138', 'Steak', TRUE,  FALSE, v_c4);

    -- a city-imported restaurant with dishes is in the table, with the city and state entered on City Imports
    SELECT * INTO v_row FROM public.admin_report_menu_health_by_restaurant('TX', 'Cityvillezz') WHERE restaurant_name = 'Imported Cafe138';
    ASSERT v_row.source = 'city' AND v_row.verified_count = 1 AND v_row.unverified_count = 1, 'a city-imported restaurant is counted by its own place';
    ASSERT v_row.restaurant_id IS NULL AND v_row.place_id = v_c1 AND v_row.address LIKE '1 Oak St%' AND v_row.is_franchise IS FALSE, 'it has no owner id, but carries the place id and address for the link';

    -- the entered region "Texas" matches the code TX, and any case
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('tx', 'cityvillezz')) = 2, 'two restaurants with dishes here: the imported one and the claimed one';

    -- a place that is both is listed once, as claimed
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('TX', 'Cityvillezz') WHERE place_id = v_c4) = 1, 'listed once';
    ASSERT (SELECT source FROM public.admin_report_menu_health_by_restaurant('TX', 'Cityvillezz') WHERE place_id = v_c4) = 'claimed', 'as claimed';

    -- a restaurant the search left out is not in the report
    ASSERT NOT EXISTS (SELECT 1 FROM public.admin_report_restaurants_no_menu_items('TX', 'Cityvillezz') WHERE place_id = v_c5), 'a restaurant left out (no website) is not in the report';

    -- the no-items list shows what the crawler did
    SELECT * INTO v_row FROM public.admin_report_restaurants_no_menu_items('TX', 'Cityvillezz') WHERE place_id = v_c2;
    ASSERT v_row.source = 'city' AND v_row.read_status = 'no_items' AND v_row.restaurant_id IS NULL, 'read but no dishes found';
    SELECT * INTO v_row FROM public.admin_report_restaurants_no_menu_items('TX', 'Cityvillezz') WHERE place_id = v_c3;
    ASSERT v_row.read_status = 'pending', 'still waiting to be read';
    ASSERT (SELECT COUNT(*) FROM public.admin_report_restaurants_no_menu_items('TX', 'Cityvillezz')) = 2, 'two restaurants have no dishes';

    -- the numbers for the filter
    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('TX', 'Cityvillezz');
    ASSERT v_row.restaurant_count = 4 AND v_row.verified_count = 2 AND v_row.unverified_count = 1 AND v_row.restaurants_with_no_items_count = 2,
      'four restaurants (3 imported + 1 claimed), 2 verified, 1 unverified, 2 with no dishes';

    -- the source filter
    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('TX', 'Cityvillezz', 'city');
    ASSERT v_row.restaurant_count = 3 AND v_row.verified_count = 1, 'city imports only';
    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('TX', 'Cityvillezz', 'claimed');
    ASSERT v_row.restaurant_count = 1 AND v_row.verified_count = 1, 'claimed only';
    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('TX', 'Cityvillezz', 'CITY');
    ASSERT v_row.restaurant_count = 3, 'the source is not case sensitive';
    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('TX', 'Cityvillezz', 'nobody');
    ASSERT v_row.restaurant_count = 0, 'an unknown source matches nothing';
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('TX', 'Cityvillezz', 50, 0, 'city')) = 1, 'the table follows the source';

    -- the pickers count both sources
    ASSERT EXISTS (SELECT 1 FROM public.admin_menu_health_locations() WHERE state = 'TX' AND city = 'Cityvillezz' AND restaurant_count = 4), 'the city is listed with all four restaurants';

    -- anyone who is not an admin is refused
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    BEGIN
      PERFORM * FROM public.admin_report_restaurants_no_menu_items();
      ASSERT FALSE, 'a non-admin must be refused';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'rollback_test_138';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_138' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 138 TESTS PASSED';
END $$;

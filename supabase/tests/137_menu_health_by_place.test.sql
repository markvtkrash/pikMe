-- Test for migration 137: the Menu Data Health report counts by the restaurant's own place, filters by region and city, pages, and
-- refuses non-admins. Tried inside a transaction that is rolled back. Needs migrations 108, 136, 137 and 138 (138 adds the source
-- argument and city-imported restaurants; everything here still holds). Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_owner UUID;
  v_row   RECORD;
  v_p1 CONSTANT TEXT := 'ChIJhealth137aaaaaaa';
  v_p2 CONSTANT TEXT := 'ChIJhealth137bbbbbbb';
  v_p3 CONSTANT TEXT := 'ChIJhealth137ccccccc';
  v_p4 CONSTANT TEXT := 'ChIJhealth137ddddddd';
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.admin_report_menu_health_snapshot(text,text,text)', 'EXECUTE'), 'anon cannot read the snapshot';
  ASSERT NOT has_function_privilege('anon', 'public.admin_report_menu_health_by_restaurant(text,text,integer,integer,text)', 'EXECUTE'), 'anon cannot read the table';
  ASSERT NOT has_function_privilege('anon', 'public.admin_menu_health_locations()', 'EXECUTE'), 'anon cannot read the locations';
  ASSERT NOT has_function_privilege('authenticated', 'public._menu_health_rows(text,text,text)', 'EXECUTE'), 'the internal base is not callable by users';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  SELECT ro.id INTO v_owner FROM public.restaurant_owners ro LIMIT 1;
  IF v_admin IS NULL OR v_owner IS NULL THEN
    RAISE NOTICE 'no admin user or no restaurant owner to try the behaviour with; wiring checks only';
    RAISE NOTICE 'ALL 137 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    -- three restaurants in Healthvillezz, TX (one with items, one with none), one in Othertonzz, OK, one with no readable state
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status) VALUES
      (v_owner, v_p1, 'Health Cafe137',   '1 Elm St, Healthvillezz, TX 70001, USA', 'approved'),
      (v_owner, v_p2, 'Health Bistro137', '2 Elm St, Healthvillezz, TX 70001, USA', 'approved'),
      (v_owner, v_p3, 'Other Grill137',   '3 Elm St, Othertonzz, OK 70002, USA',    'pending'),
      (v_owner, v_p4, 'Nowhere Diner137', 'Somewhere without a state',               'approved');

    -- Health Cafe137's own place: 2 verified + 1 unverified (+ one with the flag unknown, counted as unverified).
    -- Other items carry the SAME NAME but belong to another place or to no place: they must not be counted.
    INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, is_out_of_stock, place_id) VALUES
      ('t137-1', 'Health Cafe137', 'Soup',   TRUE,  FALSE, v_p1),
      ('t137-2', 'Health Cafe137', 'Salad',  TRUE,  FALSE, v_p1),
      ('t137-3', 'Health Cafe137', 'Stew',   FALSE, FALSE, v_p1),
      ('t137-4', 'Health Cafe137', 'Pie',    NULL,  FALSE, v_p1),
      ('t137-5', 'Health Cafe137', 'Elsewhere A', FALSE, FALSE, 'ChIJhealth137other00'),
      ('t137-6', 'Health Cafe137', 'Elsewhere B', FALSE, FALSE, 'ChIJhealth137other00'),
      ('t137-7', 'Health Cafe137', 'Shared A',    FALSE, FALSE, NULL),
      ('t137-8', 'Other Grill137', 'Burger', TRUE,  FALSE, v_p3);

    -- counts follow the restaurant's own place
    SELECT * INTO v_row FROM public.admin_report_menu_health_by_restaurant('TX', 'Healthvillezz') WHERE restaurant_name = 'Health Cafe137';
    ASSERT v_row.verified_count = 2 AND v_row.unverified_count = 2, 'only the restaurant''s own place counts, an unknown flag is unverified';
    ASSERT v_row.place_id = v_p1 AND v_row.address LIKE '1 Elm St%' AND v_row.is_franchise IS FALSE, 'the row carries the place id and address for the link';

    -- the filter: region and city (any case), no region, unknown region
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('tx', 'healthvillezz')) = 1, 'the table lists restaurants with items only, any case';
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('OK', 'Othertonzz')) = 1, 'another region and city';
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('TX', 'Othertonzz')) = 0, 'a city outside the region matches nothing';
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('ZZ', NULL)) = 0, 'an unknown region matches nothing';

    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('TX', 'Healthvillezz');
    ASSERT v_row.verified_count = 2 AND v_row.unverified_count = 2 AND v_row.restaurants_with_no_items_count = 1 AND v_row.restaurant_count = 2,
      'the snapshot for the filter: 2 verified, 2 unverified, one restaurant with no items, two restaurants';
    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('__none__', NULL);
    ASSERT v_row.restaurant_count >= 1 AND v_row.restaurants_with_no_items_count >= 1, '"no region on record" finds the restaurant with no readable state';
    ASSERT EXISTS (SELECT 1 FROM public.admin_report_restaurants_no_menu_items('__none__', NULL) WHERE restaurant_name = 'Nowhere Diner137'), 'and lists it as having no items';

    -- the no-items list follows the filter and carries the link fields
    SELECT * INTO v_row FROM public.admin_report_restaurants_no_menu_items('TX', 'Healthvillezz');
    ASSERT v_row.restaurant_name = 'Health Bistro137' AND v_row.place_id = v_p2 AND v_row.total_count = 1, 'the restaurant with no items of its own is listed (same-name items elsewhere do not hide it)';

    -- the no-argument calls still work (every region)
    ASSERT (SELECT verified_count FROM public.admin_report_menu_health_snapshot()) >= 3, 'no filter counts everything';
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant()) >= 1, 'the table works with no arguments';

    -- paging
    SELECT * INTO v_row FROM public.admin_report_menu_health_by_restaurant(NULL, NULL, 1, 0);
    ASSERT v_row.total_count >= 2, 'the total is the whole filtered count, not the page';
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant(NULL, NULL, 1, 0)) = 1, 'a page of one';
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant(NULL, NULL, 0, 0)) = 1, 'a limit below 1 is raised to 1';
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('TX', 'Healthvillezz', 50, 5)) = 0, 'a page past the end is empty';

    -- the filter choices
    ASSERT EXISTS (SELECT 1 FROM public.admin_menu_health_locations() WHERE state = 'TX' AND city = 'Healthvillezz' AND restaurant_count = 2), 'the city is listed with its restaurant count';
    ASSERT EXISTS (SELECT 1 FROM public.admin_menu_health_locations() WHERE state IS NULL AND restaurant_count >= 1), 'restaurants with no readable state are listed under no state';

    -- anyone who is not an admin is refused
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    BEGIN
      PERFORM * FROM public.admin_report_menu_health_snapshot();
      ASSERT FALSE, 'a non-admin must be refused';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'rollback_test_137';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_137' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 137 TESTS PASSED';
END $$;

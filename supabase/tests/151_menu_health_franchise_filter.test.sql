-- Test for migration 151: the Menu Data Health report filters by franchise vs independent, alongside region/city/source. The
-- franchise fixtures are both city-imported (never claimed), which also exercises 151's fix to _menu_health_scope() --
-- migration 138 hardcoded a city-imported restaurant's franchise flag to FALSE, so a city-found franchise location was
-- always shown (and miscounted) as independent. Tried inside a transaction that is rolled back.
-- Needs migrations 108, 134, 136, 137, 138, 151. Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_city  UUID;
  v_row   RECORD;
  v_f1 CONSTANT TEXT := 'ChIJfr151aaaaaaaaaaa'; -- franchise, has items
  v_f2 CONSTANT TEXT := 'ChIJfr151bbbbbbbbbbb'; -- franchise, no items
  v_i1 CONSTANT TEXT := 'ChIJfr151ccccccccccc'; -- independent, has items
  v_i2 CONSTANT TEXT := 'ChIJfr151ddddddddddd'; -- independent, no items
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.admin_report_menu_health_by_restaurant(text,text,integer,integer,text,text)', 'EXECUTE'),
    'anon cannot read the table';
  ASSERT NOT has_function_privilege('anon', 'public.admin_report_restaurants_no_menu_items(text,text,integer,integer,text,text)', 'EXECUTE'),
    'anon cannot read the no-items list';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user to try the behaviour with; wiring checks only';
    RAISE NOTICE 'ALL 151 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    INSERT INTO public.franchise_chains (name) VALUES ('Franchise151 Diner'), ('Franchise151 Empty');

    INSERT INTO public.crawl_cities (name, region, max_restaurants) VALUES ('Franvillezz151', 'Texas', 20) RETURNING id INTO v_city;
    INSERT INTO public.city_places (city_id, place_id, name, address, website, outcome) VALUES
      (v_city, v_f1, 'Franchise151 Diner',   '1 Oak St, Franvillezz151, TX 71001, USA', 'https://f1.example.com', 'queued'),
      (v_city, v_f2, 'Franchise151 Empty',   '2 Oak St, Franvillezz151, TX 71001, USA', 'https://f2.example.com', 'queued'),
      (v_city, v_i1, 'Independent151 Cafe',  '3 Oak St, Franvillezz151, TX 71001, USA', 'https://i1.example.com', 'queued'),
      (v_city, v_i2, 'Independent151 Empty', '4 Oak St, Franvillezz151, TX 71001, USA', 'https://i2.example.com', 'queued');
    -- a franchise's items are keyed by name (place_id NULL), an independent's by its own place
    INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, is_out_of_stock, place_id) VALUES
      ('t151-1', 'Franchise151 Diner',  'Combo',  TRUE,  FALSE, NULL),
      ('t151-2', 'Franchise151 Diner',  'Side',   FALSE, FALSE, NULL),
      ('t151-3', 'Independent151 Cafe', 'Omelet', TRUE,  FALSE, v_i1);

    -- no franchise filter: all four are in scope
    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('TX', 'Franvillezz151');
    ASSERT v_row.restaurant_count = 4, 'unfiltered restaurant_count should be 4, got ' || v_row.restaurant_count;
    ASSERT v_row.verified_count = 2, 'unfiltered verified_count should be 2, got ' || v_row.verified_count;
    ASSERT v_row.unverified_count = 1, 'unfiltered unverified_count should be 1, got ' || v_row.unverified_count;
    ASSERT v_row.restaurants_with_no_items_count = 2, 'unfiltered restaurants_with_no_items_count should be 2, got ' || v_row.restaurants_with_no_items_count;

    -- franchise only
    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('TX', 'Franvillezz151', NULL, 'franchise');
    ASSERT v_row.restaurant_count = 2, 'franchise-only restaurant_count should be 2, got ' || v_row.restaurant_count;
    ASSERT v_row.verified_count = 1, 'franchise-only verified_count should be 1, got ' || v_row.verified_count;
    ASSERT v_row.unverified_count = 1, 'franchise-only unverified_count should be 1, got ' || v_row.unverified_count;
    ASSERT v_row.restaurants_with_no_items_count = 1, 'franchise-only restaurants_with_no_items_count should be 1, got ' || v_row.restaurants_with_no_items_count;
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('TX', 'Franvillezz151', 50, 0, NULL, 'franchise')) = 1,
      'the table (items > 0) has one franchise row';
    SELECT * INTO v_row FROM public.admin_report_menu_health_by_restaurant('TX', 'Franvillezz151', 50, 0, NULL, 'franchise') WHERE place_id = v_f1;
    ASSERT v_row.is_franchise IS TRUE, 'the franchise row is marked as a franchise';
    ASSERT v_row.verified_count = 1 AND v_row.unverified_count = 1, 'the franchise row has its name-keyed counts, got verified=' || v_row.verified_count || ' unverified=' || v_row.unverified_count;
    SELECT * INTO v_row FROM public.admin_report_restaurants_no_menu_items('TX', 'Franvillezz151', 50, 0, NULL, 'franchise');
    ASSERT v_row.place_id = v_f2 AND v_row.is_franchise IS TRUE, 'the no-items list has the empty franchise location only, got place_id=' || v_row.place_id;

    -- independent only
    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('TX', 'Franvillezz151', NULL, 'independent');
    ASSERT v_row.restaurant_count = 2, 'independent-only restaurant_count should be 2, got ' || v_row.restaurant_count;
    ASSERT v_row.verified_count = 1, 'independent-only verified_count should be 1, got ' || v_row.verified_count;
    ASSERT v_row.unverified_count = 0, 'independent-only unverified_count should be 0, got ' || v_row.unverified_count;
    ASSERT v_row.restaurants_with_no_items_count = 1, 'independent-only restaurants_with_no_items_count should be 1, got ' || v_row.restaurants_with_no_items_count;
    SELECT * INTO v_row FROM public.admin_report_menu_health_by_restaurant('TX', 'Franvillezz151', 50, 0, NULL, 'independent') WHERE place_id = v_i1;
    ASSERT v_row.is_franchise IS FALSE, 'the independent row is not marked as a franchise';
    SELECT * INTO v_row FROM public.admin_report_restaurants_no_menu_items('TX', 'Franvillezz151', 50, 0, NULL, 'independent');
    ASSERT v_row.place_id = v_i2 AND v_row.is_franchise IS FALSE, 'the no-items list has the empty independent restaurant only, got place_id=' || v_row.place_id;

    -- not case sensitive, and an unknown value matches nothing
    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('TX', 'Franvillezz151', NULL, 'FRANCHISE');
    ASSERT v_row.restaurant_count = 2, 'the franchise filter is not case sensitive';
    SELECT * INTO v_row FROM public.admin_report_menu_health_snapshot('TX', 'Franvillezz151', NULL, 'nobody');
    ASSERT v_row.restaurant_count = 0, 'an unknown franchise filter value matches nothing';

    -- combines with the source filter already in place
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_snapshot('TX', 'Franvillezz151', 'city', 'franchise')) = 1,
      'combines with source: still finds the city-imported franchise rows';

    -- anyone who is not an admin is refused
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    BEGIN
      PERFORM * FROM public.admin_report_menu_health_by_restaurant();
      ASSERT FALSE, 'a non-admin must be refused';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'rollback_test_151';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_151' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 151 TESTS PASSED';
END $$;

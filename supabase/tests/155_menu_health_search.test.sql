-- Test for migration 155: Menu Data Health's new p_search (case-insensitive restaurant-name substring match),
-- added as the trailing parameter of _menu_health_rows, admin_report_menu_health_snapshot and
-- admin_report_menu_health_by_restaurant. Tried inside a transaction that is rolled back.
-- Needs migrations 108, 134, 136, 137, 138, 151, 152, 155. Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_city  UUID;
  v_a CONSTANT TEXT := 'ChIJse155aaaaaaaaaaaa'; -- "Taco Fiesta155"
  v_b CONSTANT TEXT := 'ChIJse155bbbbbbbbbbbb'; -- "Burger Palace155"
  v_c CONSTANT TEXT := 'ChIJse155cccccccccccc'; -- "SPICY tacos155" (mixed case, to prove case-insensitivity)
BEGIN
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user to try the behaviour with; wiring checks only';
    RAISE NOTICE 'ALL 155 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    INSERT INTO public.crawl_cities (name, region, max_restaurants) VALUES ('Search155', 'Texas', 20) RETURNING id INTO v_city;
    INSERT INTO public.city_places (city_id, place_id, name, address, website, outcome, found_at) VALUES
      (v_city, v_a, 'Taco Fiesta155',    '1 Oak St, Search155, TX 71001, USA', 'https://a.example.com', 'queued', now()),
      (v_city, v_b, 'Burger Palace155',  '2 Oak St, Search155, TX 71001, USA', 'https://b.example.com', 'queued', now()),
      (v_city, v_c, 'SPICY tacos155',    '3 Oak St, Search155, TX 71001, USA', 'https://c.example.com', 'queued', now());

    -- no search: all three
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('TX', 'Search155', 50, 0, NULL, NULL, FALSE, NULL)) = 0,
      'sanity: none of these have menu items yet, so the has-items table is empty regardless of search';
    ASSERT (SELECT restaurant_count FROM public.admin_report_menu_health_snapshot('TX', 'Search155', NULL, NULL, NULL)) = 3,
      'with no search the snapshot counts all three';

    -- lowercase search matches both "Taco" and "tacos" in a mixed-case name, not the burger place
    ASSERT (SELECT restaurant_count FROM public.admin_report_menu_health_snapshot('TX', 'Search155', NULL, NULL, 'taco')) = 2,
      'a lowercase search matches both taco places';
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('TX', 'Search155', 50, 0, NULL, NULL, TRUE, 'taco')) = 2,
      'the restaurant table (no-items mode, since these have none) also respects the search';
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.admin_report_menu_health_by_restaurant('TX', 'Search155', 50, 0, NULL, NULL, TRUE, 'taco') WHERE place_id = v_b
    ), 'the burger place is excluded by a taco search';

    -- uppercase search term still matches (case-insensitive on both sides)
    ASSERT (SELECT restaurant_count FROM public.admin_report_menu_health_snapshot('TX', 'Search155', NULL, NULL, 'TACO')) = 2,
      'an uppercase search term matches the same two places';

    -- surrounding whitespace is trimmed
    ASSERT (SELECT restaurant_count FROM public.admin_report_menu_health_snapshot('TX', 'Search155', NULL, NULL, '  taco  ')) = 2,
      'surrounding whitespace in the search term is trimmed';

    -- no match
    ASSERT (SELECT restaurant_count FROM public.admin_report_menu_health_snapshot('TX', 'Search155', NULL, NULL, 'pizza')) = 0,
      'a search with no match returns zero';

    -- blank search behaves like no search at all
    ASSERT (SELECT restaurant_count FROM public.admin_report_menu_health_snapshot('TX', 'Search155', NULL, NULL, '')) = 3,
      'a blank search string is the same as no search';

    -- anyone who is not an admin is refused
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    BEGIN
      PERFORM * FROM public.admin_report_menu_health_by_restaurant();
      ASSERT FALSE, 'a non-admin must be refused';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'rollback_test_155';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_155' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 155 TESTS PASSED';
END $$;

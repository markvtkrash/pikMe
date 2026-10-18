-- Test for migration 152: "No menu items at all" is folded into admin_report_menu_health_by_restaurant as p_no_items,
-- and admin_report_restaurants_no_menu_items is gone. Tried inside a transaction that is rolled back.
-- Needs migrations 108, 134, 136, 137, 138, 151, 152. Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_city  UUID;
  v_row   RECORD;
  v_a CONSTANT TEXT := 'ChIJni152aaaaaaaaaaa'; -- has items, found later
  v_b CONSTANT TEXT := 'ChIJni152bbbbbbbbbbb'; -- no items, found earlier (should sort first)
  v_c CONSTANT TEXT := 'ChIJni152ccccccccccc'; -- no items, found later
BEGIN
  ASSERT to_regprocedure('public.admin_report_restaurants_no_menu_items(text,text,integer,integer,text,text)') IS NULL,
    'the separate no-items function is gone';
  ASSERT NOT has_function_privilege('anon', 'public.admin_report_menu_health_by_restaurant(text,text,integer,integer,text,text,boolean)', 'EXECUTE'),
    'anon cannot read the table';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user to try the behaviour with; wiring checks only';
    RAISE NOTICE 'ALL 152 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    INSERT INTO public.crawl_cities (name, region, max_restaurants) VALUES ('Noitemsville152', 'Texas', 20) RETURNING id INTO v_city;
    INSERT INTO public.city_places (city_id, place_id, name, address, website, outcome, found_at) VALUES
      (v_city, v_a, 'HasItems152',   '1 Oak St, Noitemsville152, TX 71001, USA', 'https://a.example.com', 'queued', now() - interval '1 day'),
      (v_city, v_b, 'NoItemsEarly152', '2 Oak St, Noitemsville152, TX 71001, USA', 'https://b.example.com', 'queued', now() - interval '10 days'),
      (v_city, v_c, 'NoItemsLate152',  '3 Oak St, Noitemsville152, TX 71001, USA', 'https://c.example.com', 'queued', now() - interval '2 days');
    INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, is_out_of_stock, place_id) VALUES
      ('t152-1', 'HasItems152', 'Soup', TRUE, FALSE, v_a);

    -- default: only the restaurant with items
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('TX', 'Noitemsville152')) = 1,
      'default shows only restaurants with items';
    ASSERT (SELECT place_id FROM public.admin_report_menu_health_by_restaurant('TX', 'Noitemsville152')) = v_a,
      'the one with items is the right one';

    -- p_no_items = false explicitly: same as default
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('TX', 'Noitemsville152', 50, 0, NULL, NULL, FALSE)) = 1,
      'explicit false behaves like the default';

    -- p_no_items = true: only the two with zero items, oldest (earliest found_at) first
    ASSERT (SELECT COUNT(*) FROM public.admin_report_menu_health_by_restaurant('TX', 'Noitemsville152', 50, 0, NULL, NULL, TRUE)) = 2,
      'p_no_items shows the two restaurants with zero items';
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.admin_report_menu_health_by_restaurant('TX', 'Noitemsville152', 50, 0, NULL, NULL, TRUE) WHERE place_id = v_a
    ), 'the restaurant with items is excluded when p_no_items is true';
    SELECT * INTO v_row FROM public.admin_report_menu_health_by_restaurant('TX', 'Noitemsville152', 50, 0, NULL, NULL, TRUE) LIMIT 1;
    ASSERT v_row.place_id = v_b, 'the longest-neglected (earliest found_at) restaurant with no items comes first, got ' || v_row.place_id;

    -- anyone who is not an admin is refused
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    BEGIN
      PERFORM * FROM public.admin_report_menu_health_by_restaurant();
      ASSERT FALSE, 'a non-admin must be refused';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'rollback_test_152';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_152' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 152 TESTS PASSED';
END $$;

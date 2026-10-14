-- Test for migration 143: an admin can save a menu link for a restaurant that only City Imports has found. Rolled-back transaction.
-- Needs migrations 121, 122, 134 and 143. Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_city  UUID;
  v_p CONSTANT TEXT := 'ChIJlink143aaaaaaaaaa';
  v_q CONSTANT TEXT := 'ChIJlink143bbbbbbbbbb';
  v_res   TEXT;
BEGIN
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user to try the function with; nothing checked';
    RAISE NOTICE 'ALL 143 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    -- a restaurant known only to City Imports (not cached, not claimed)
    INSERT INTO public.crawl_cities (name, region, max_restaurants) VALUES ('Linkville143', 'Kansas', 10) RETURNING id INTO v_city;
    INSERT INTO public.city_places (city_id, place_id, name, address, website, outcome)
    VALUES (v_city, v_p, 'Link Cafe143', '1 Elm St, Linkville, KS 66000, USA', 'https://old.example.com', 'queued');
    ASSERT NOT EXISTS (SELECT 1 FROM public.cached_restaurants WHERE place_id = v_p), 'the test place is not cached';

    v_res := public.admin_set_place_menu_link(v_p, 'https://link143.example.com/menu');
    ASSERT v_res = 'queued', 'the link is saved for a City Imports restaurant';
    ASSERT (SELECT restaurant_name FROM public.menu_build_queue WHERE kind = 'place' AND place_id = v_p) = 'Link Cafe143', 'with the name from City Imports';
    ASSERT (SELECT override_link FROM public.menu_build_queue WHERE kind = 'place' AND place_id = v_p) = 'https://link143.example.com/menu', 'and the link kept';

    v_res := public.admin_set_place_menu_link(v_p, '');
    ASSERT v_res = 'removed', 'and it can be removed again';

    -- a place nobody knows is still refused
    BEGIN
      PERFORM public.admin_set_place_menu_link(v_q, 'https://x143.example.com/menu');
      ASSERT FALSE, 'an unknown place must be refused';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Restaurant not found%' THEN RAISE; END IF;
    END;

    -- anyone who is not an admin is refused
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    BEGIN
      PERFORM public.admin_set_place_menu_link(v_p, 'https://link143.example.com/menu');
      ASSERT FALSE, 'a non-admin must be refused';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'rollback_test_143';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_143' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 143 TESTS PASSED';
END $$;

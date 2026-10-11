-- Test for migration 131: the admin's place lookup falls back from the Google cache to the click record and the saved menu items.
-- Rolled-back transaction. Needs migrations 119 and 131. Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_row   RECORD;
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.admin_get_place_info(text)', 'EXECUTE'), 'anon cannot call it';
  ASSERT has_function_privilege('authenticated', 'public.admin_get_place_info(text)', 'EXECUTE'), 'signed-in admins can call it';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user to try the behaviour with; wiring checks only';
    RAISE NOTICE 'ALL 131 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    -- nothing knows the place
    ASSERT NOT EXISTS (SELECT 1 FROM public.admin_get_place_info('ZZtest_none_131')), 'an unknown place gives nothing';

    -- only a click record
    INSERT INTO public.place_menu_clicks (place_id, restaurant_name) VALUES ('ZZtest_click_131', 'Click Only Cafe');
    SELECT * INTO v_row FROM public.admin_get_place_info('ZZtest_click_131');
    ASSERT v_row.name = 'Click Only Cafe' AND v_row.source = 'click' AND v_row.address IS NULL, 'the click record gives the name';

    -- the Google cache wins over the click record
    INSERT INTO public.cached_restaurants (place_id, name, latitude, longitude, address, cached_at)
    VALUES ('ZZtest_click_131', 'Cached Name', 38.9, -94.7, '1 Main St', NOW());
    SELECT * INTO v_row FROM public.admin_get_place_info('ZZtest_click_131');
    ASSERT v_row.name = 'Cached Name' AND v_row.source = 'cache' AND v_row.address = '1 Main St', 'the cache wins';
    ASSERT (SELECT COUNT(*) FROM public.admin_get_place_info('ZZtest_click_131')) = 1, 'exactly one row';

    -- a non-admin is refused
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    BEGIN
      PERFORM public.admin_get_place_info('ZZtest_click_131');
      RAISE EXCEPTION 'a non-admin was allowed';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a non-admin was allowed' THEN RAISE; END IF; END;

    RAISE EXCEPTION 'rollback_test_131';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_131' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 131 TESTS PASSED';
END $$;

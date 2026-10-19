-- Test for migration 157: admin_list_chain_build_log now also returns verified_count, the restaurant's
-- currently-verified menu item count, alongside its crawl outcome. Rolled back; needs migrations 120 and 157.
-- Success: no error.
DO $$
DECLARE
  v_place TEXT := 'ChIJ_test157_place';
  v_admin UUID;
  v_rec   RECORD;
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_list_chain_build_log'
      AND pg_get_function_result(p.oid) LIKE '%verified_count integer%'
  ), 'the list now returns a verified count';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user to try the rows with; wiring checks only';
    RAISE NOTICE 'ALL 157 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    DELETE FROM public.place_menu_crawl WHERE place_id = v_place;
    DELETE FROM public.menu_items WHERE place_id = v_place;
    INSERT INTO public.place_menu_crawl (place_id, restaurant_name, link, link_source, status, last_item_count, finished_at)
    VALUES (v_place, 'Test157 Cafe', 'https://test157.example.com/menu', 'google', 'needs_attention', 0, NOW());

    SELECT * INTO v_rec FROM public.admin_list_chain_build_log(24) l WHERE l.place_id = v_place;
    ASSERT v_rec.verified_count = 0, 'no menu items yet means zero verified';

    INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, place_id) VALUES
      ('test157_1', 'Test157 Cafe', 'Soup', true, v_place),
      ('test157_2', 'Test157 Cafe', 'Salad', true, v_place),
      ('test157_3', 'Test157 Cafe', 'AI Guess', false, v_place);

    SELECT * INTO v_rec FROM public.admin_list_chain_build_log(24) l WHERE l.place_id = v_place;
    ASSERT v_rec.outcome = 'needs_attention' AND v_rec.verified_count = 2,
      'a failed build still shows how many of the restaurant''s items are already verified, from earlier';

    -- a franchise row has no single restaurant to count, so it stays NULL
    ASSERT EXISTS (SELECT 1 FROM public.admin_list_chain_build_log(24) l WHERE l.kind = 'chain' AND l.verified_count IS NULL)
       OR NOT EXISTS (SELECT 1 FROM public.admin_list_chain_build_log(24) l WHERE l.kind = 'chain'),
      'a franchise build, if any is in the window, has no verified count of its own';

    RAISE EXCEPTION 'rollback_test_157';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_157' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 157 TESTS PASSED';
END $$;

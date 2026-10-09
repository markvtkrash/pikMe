-- Test for migration 120: "Recent builds" shows the crawler's reads for independent restaurants. Wiring and access come
-- from the catalog; the rows are checked on a rolled-back transaction. Needs migrations 105, 114 and 120. Success: no error.
DO $$
DECLARE
  v_place TEXT := 'ChIJ_test120_place';
  v_admin UUID;
  v_rec   RECORD;
BEGIN
  ASSERT has_function_privilege('authenticated', 'public.admin_list_chain_build_log(integer)', 'EXECUTE'), 'admins call it';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_chain_build_log(integer)', 'EXECUTE'), 'anon cannot';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_list_chain_build_log'
      AND pg_get_function_result(p.oid) LIKE '%place_id text%'
  ), 'the list now returns the place';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user to try the rows with; wiring checks only';
    RAISE NOTICE 'ALL 120 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    DELETE FROM public.place_menu_crawl WHERE place_id = v_place;
    INSERT INTO public.place_menu_crawl (place_id, restaurant_name, link, link_source, status, last_item_count, finished_at)
    VALUES (v_place, 'Test120 Cafe', 'https://test120.example.com/menu', 'google', 'done', 7, NOW());

    SELECT * INTO v_rec FROM public.admin_list_chain_build_log(24) l WHERE l.place_id = v_place;
    ASSERT v_rec.kind = 'place' AND v_rec.outcome = 'ok' AND v_rec.item_count = 7 AND v_rec.source = 'google',
      'a finished read shows as ok with its dishes and where the link came from';

    UPDATE public.place_menu_crawl SET status = 'no_items', last_item_count = 0 WHERE place_id = v_place;
    SELECT * INTO v_rec FROM public.admin_list_chain_build_log(24) l WHERE l.place_id = v_place;
    ASSERT v_rec.outcome = 'no_items', 'a page without dishes shows as no_items';

    UPDATE public.place_menu_crawl SET status = 'pending', finished_at = NULL WHERE place_id = v_place;
    SELECT * INTO v_rec FROM public.admin_list_chain_build_log(24) l WHERE l.place_id = v_place;
    ASSERT v_rec.outcome = 'waiting' AND v_rec.finished_at IS NULL, 'a queued link shows as waiting';

    UPDATE public.place_menu_crawl SET status = 'crawling', claimed_at = NOW() WHERE place_id = v_place;
    SELECT * INTO v_rec FROM public.admin_list_chain_build_log(24) l WHERE l.place_id = v_place;
    ASSERT v_rec.outcome = 'running', 'a read in progress shows as running';

    UPDATE public.place_menu_crawl SET claimed_at = NOW() - INTERVAL '2 hours', requested_at = NOW() - INTERVAL '2 hours' WHERE place_id = v_place;
    SELECT * INTO v_rec FROM public.admin_list_chain_build_log(24) l WHERE l.place_id = v_place;
    ASSERT v_rec.outcome = 'no_result', 'a read stuck for over 30 minutes shows as no_result';

    -- outside the window it is not listed
    UPDATE public.place_menu_crawl SET claimed_at = NOW() - INTERVAL '3 days', requested_at = NOW() - INTERVAL '3 days' WHERE place_id = v_place;
    ASSERT NOT EXISTS (SELECT 1 FROM public.admin_list_chain_build_log(24) l WHERE l.place_id = v_place), 'old reads are left out of a 24 hour list';
    ASSERT EXISTS (SELECT 1 FROM public.admin_list_chain_build_log(168) l WHERE l.place_id = v_place), 'and shown in a 7 day list';

    RAISE EXCEPTION 'rollback_test_120';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_120' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 120 TESTS PASSED';
END $$;

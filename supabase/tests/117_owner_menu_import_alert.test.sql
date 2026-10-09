-- Test for migration 117: the owner's "menu import was not successful" alert. Wiring and access are checked from the catalog;
-- the behaviour is tried on one real restaurant inside a transaction that is rolled back, so nothing is left behind.
-- Needs migrations 114 and 117. Success: no error.
DO $$
DECLARE
  v_rest      public.restaurants%ROWTYPE;
  v_count     INTEGER;
  v_status    TEXT;
  v_link      TEXT := 'https://menu-test-117.example.com/menu';
BEGIN
  -- access: signed-in owners only
  ASSERT has_function_privilege('authenticated', 'public.owner_menu_import_alert()', 'EXECUTE'), 'signed-in owners can ask';
  ASSERT NOT has_function_privilege('anon', 'public.owner_menu_import_alert()', 'EXECUTE'), 'anon cannot';
  ASSERT has_function_privilege('authenticated', 'public.owner_dismiss_menu_import_alert()', 'EXECUTE'), 'signed-in owners can dismiss';
  ASSERT NOT has_function_privilege('anon', 'public.owner_dismiss_menu_import_alert()', 'EXECUTE'), 'anon cannot dismiss';
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'place_menu_crawl' AND column_name = 'owner_dismissed_at'
  ), 'the dismissal column exists';

  -- behaviour, on a real approved restaurant that has a place ID (rolled back below)
  SELECT * INTO v_rest FROM public.restaurants r
  WHERE r.status = 'approved' AND r.google_place_id IS NOT NULL AND NOT public.is_franchise_chain(r.name)
  ORDER BY r.created_at LIMIT 1;
  IF v_rest.id IS NULL THEN
    RAISE NOTICE 'no approved restaurant with a place ID to try the behaviour on; wiring checks only';
    RAISE NOTICE 'ALL 117 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_rest.owner_id::text, true);
    DELETE FROM public.place_menu_crawl WHERE place_id = v_rest.google_place_id;
    UPDATE public.menu_build_queue SET override_link = NULL WHERE kind = 'place' AND place_id = v_rest.google_place_id;
    DELETE FROM public.menu_items WHERE place_id = v_rest.google_place_id AND item_id NOT LIKE 'ai\_%' ESCAPE '\';
    UPDATE public.restaurants SET menu_link = v_link WHERE id = v_rest.id;      -- (the trigger records the link)

    -- nothing read yet: no alert
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_import_alert();
    ASSERT v_count = 0, 'no alert while the link is waiting to be read';

    -- a read that found no dishes: alert
    UPDATE public.place_menu_crawl SET status = 'crawling', claimed_at = NOW() WHERE place_id = v_rest.google_place_id;   -- as if handed to the worker
    PERFORM public.finish_place_crawl(v_rest.google_place_id, v_link, 'no_items', 'the page was read but no dishes', 0);
    UPDATE public.place_menu_crawl SET finished_at = NOW() - INTERVAL '1 hour' WHERE place_id = v_rest.google_place_id;
    SELECT alert_status INTO v_status FROM public.owner_menu_import_alert();
    ASSERT v_status = 'no_items', 'a page read with no dishes raises the alert';

    -- another owner sees nothing
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_import_alert();
    ASSERT v_count = 0, 'another signed-in user sees no alert about this restaurant';
    PERFORM set_config('request.jwt.claim.sub', v_rest.owner_id::text, true);

    -- the admin's link is not the owner's concern
    UPDATE public.place_menu_crawl SET link_source = 'admin' WHERE place_id = v_rest.google_place_id;
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_import_alert();
    ASSERT v_count = 0, 'an admin override link does not raise an alert for the owner';
    UPDATE public.place_menu_crawl SET link_source = 'owner' WHERE place_id = v_rest.google_place_id;

    -- the link was changed since: no alert (it is waiting to be read again)
    UPDATE public.restaurants SET menu_link = v_link || '/new' WHERE id = v_rest.id;
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_import_alert();
    ASSERT v_count = 0, 'a changed link clears the alert';
    UPDATE public.restaurants SET menu_link = v_link WHERE id = v_rest.id;
    UPDATE public.place_menu_crawl SET status = 'crawling', claimed_at = NOW() WHERE place_id = v_rest.google_place_id;   -- as if handed to the worker
    PERFORM public.finish_place_crawl(v_rest.google_place_id, v_link, 'no_items', 'again', 0);
    UPDATE public.place_menu_crawl SET finished_at = NOW() - INTERVAL '1 hour' WHERE place_id = v_rest.google_place_id;
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_import_alert();
    ASSERT v_count = 1, 'the alert is back after another empty read';

    -- dismissing hides it; a later empty read shows it again
    PERFORM public.owner_dismiss_menu_import_alert();
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_import_alert();
    ASSERT v_count = 0, 'dismissing hides it';
    UPDATE public.place_menu_crawl SET finished_at = NOW() + INTERVAL '1 minute' WHERE place_id = v_rest.google_place_id;
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_import_alert();
    ASSERT v_count = 1, 'a newer empty read shows it again';

    -- the owner followed the advice: real items added after the failed read clear it
    INSERT INTO public.menu_items (
      item_id, restaurant_name, name, calories, protein_g, total_carbs_g, total_fat_g, saturated_fat_g, sodium_mg,
      is_verified, cached_at, place_id
    ) VALUES (
      'image_test117_' || replace(v_rest.id::text, '-', ''), v_rest.name, 'Test117 Item', 100, 0, 0, 0, 0, 0, true,
      NOW() + INTERVAL '2 minutes', v_rest.google_place_id
    );
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_import_alert();
    ASSERT v_count = 0, 'real items added after the failed read clear the alert';

    -- a read that could not get the page at all (after several tries) also raises it
    DELETE FROM public.menu_items WHERE item_id = 'image_test117_' || replace(v_rest.id::text, '-', '');
    UPDATE public.place_menu_crawl
       SET status = 'needs_attention', owner_dismissed_at = NULL, finished_at = NOW() - INTERVAL '1 minute'
     WHERE place_id = v_rest.google_place_id;
    SELECT alert_status INTO v_status FROM public.owner_menu_import_alert();
    ASSERT v_status = 'needs_attention', 'a link that could not be read after several tries raises the alert';

    RAISE EXCEPTION 'rollback_test_117';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_117' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 117 TESTS PASSED';
END $$;

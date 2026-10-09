-- Test for migration 118: a customer opening an independent restaurant goes to the browser crawler.
-- Wiring is checked from the catalog; the behaviour is tried on one real cached restaurant inside a transaction that is
-- rolled back, so nothing is left behind. Needs migrations 101, 113, 114 and 118. Success: no error.
-- (Migration 125 removed the link lookup: the lookup checks below run only while that table still exists, and a click with no
-- link then gives 'no_link'.)
DO $$
DECLARE
  v_place  TEXT;
  v_name   TEXT;
  v_res    TEXT;
  v_count  INTEGER;
  v_status TEXT;
  v_src    TEXT;
  v_link   TEXT := 'https://menu-test-118.example.com/menu';
  v_has_disc BOOLEAN := to_regclass('public.place_menu_discovery') IS NOT NULL;
BEGIN
  -- wiring and access: server only
  ASSERT NOT has_function_privilege('anon', 'public.request_place_menu_import(text,text)', 'EXECUTE'), 'anon cannot request';
  ASSERT NOT has_function_privilege('authenticated', 'public.request_place_menu_import(text,text)', 'EXECUTE'), 'signed-in users cannot request';
  ASSERT has_function_privilege('service_role', 'public.request_place_menu_import(text,text)', 'EXECUTE'), 'the server can request';
  IF v_has_disc THEN
    ASSERT has_function_privilege('service_role', 'public.claim_place_discoveries(integer)', 'EXECUTE'), 'the server can claim';
    ASSERT has_function_privilege('service_role', 'public.finish_place_discovery(text,text,text,text)', 'EXECUTE'), 'the server can record';
    ASSERT NOT has_function_privilege('anon', 'public.finish_place_discovery(text,text,text,text)', 'EXECUTE'), 'anon cannot record';
    ASSERT has_table_privilege('service_role', 'public.place_menu_discovery', 'SELECT'), 'the server can read the table';
    ASSERT NOT has_table_privilege('anon', 'public.place_menu_discovery', 'SELECT'), 'anon cannot read the table';
    ASSERT public.discovery_run_limit() BETWEEN 1 AND 200, 'run limit in range';
    ASSERT (SELECT value FROM public.app_config WHERE key = 'menuClickRequestsPerDay') IS NOT NULL, 'daily cap setting exists';
    ASSERT (SELECT value FROM public.app_config WHERE key = 'menuDiscoveriesPerRun') IS NOT NULL, 'per run setting exists';
  END IF;
  ASSERT (SELECT value FROM public.app_config WHERE key = 'menuClickRetryDays') IS NOT NULL, 'retry days setting exists';

  -- the scheduled job no longer builds independents
  ASSERT (public.run_scheduled_menu_builds() ->> 'places') = '0', 'the scheduled job reports no independent builds';

  -- invalid input
  ASSERT public.request_place_menu_import(NULL, 'x') = 'invalid', 'null place is invalid';
  ASSERT public.request_place_menu_import('short', 'x') = 'invalid', 'short place is invalid';
  ASSERT public.request_place_menu_import('ChIJ_does_not_exist_118', 'Some Cafe') = 'unknown_place', 'an unknown place is refused';

  SELECT cr.place_id, cr.name INTO v_place, v_name FROM public.cached_restaurants cr
  WHERE cr.place_id ~ '^[A-Za-z0-9_-]{10,200}$' AND NOT public.is_franchise_chain(cr.name)
  ORDER BY cr.cached_at DESC LIMIT 1;
  IF v_place IS NULL THEN
    RAISE NOTICE 'no cached independent restaurant to try the behaviour on; wiring checks only';
    RAISE NOTICE 'ALL 118 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    DELETE FROM public.place_menu_crawl WHERE place_id = v_place;
    IF v_has_disc THEN EXECUTE 'DELETE FROM public.place_menu_discovery WHERE place_id = $1' USING v_place; END IF;
    UPDATE public.menu_build_queue SET override_link = NULL WHERE kind = 'place' AND place_id = v_place;
    DELETE FROM public.menu_items WHERE place_id = v_place AND item_id NOT LIKE 'ai\_%' ESCAPE '\';
    UPDATE public.restaurants SET menu_link = NULL WHERE google_place_id = v_place;
    IF v_has_disc THEN
      -- only this restaurant counts towards the daily cap during the test
      EXECUTE 'DELETE FROM public.place_menu_discovery WHERE requested_at > NOW() - INTERVAL ''24 hours''';
      UPDATE public.app_config SET value = '50' WHERE key = 'menuClickRequestsPerDay';
    END IF;
    UPDATE public.app_config SET value = '30' WHERE key = 'menuClickRetryDays';

    -- 1. a click with no link known: without the lookup (migration 125) it gives 'no_link' and queues nothing
    v_res := public.enqueue_menu_build(v_place, v_name);
    IF NOT v_has_disc THEN
      ASSERT v_res = 'no_link', 'a click with no link gives no_link, got ' || v_res;
      ASSERT NOT EXISTS (SELECT 1 FROM public.place_menu_crawl WHERE place_id = v_place), 'nothing is queued for the crawler';
    END IF;
    ASSERT NOT EXISTS (SELECT 1 FROM public.menu_build_queue WHERE kind = 'place' AND place_id = v_place AND status = 'waiting'),
      'the old place queue is not used';

    IF v_has_disc THEN
      ASSERT v_res = 'queued', 'a click queues the lookup, got ' || v_res;
      ASSERT public.enqueue_menu_build(v_place, v_name) = 'already_queued', 'a second click does not queue again';
      -- the worker run: claim, then a found link goes to the crawler as a google link
      SELECT COUNT(*) INTO v_count FROM public.claim_place_discoveries(10);
      ASSERT v_count >= 1, 'the lookup is handed out';
      ASSERT public.finish_place_discovery(v_place, 'found', v_link, NULL) = 'found', 'the found link is recorded';
      SELECT status, link_source INTO v_status, v_src FROM public.place_menu_crawl WHERE place_id = v_place;
      ASSERT v_status = 'pending' AND v_src = 'google', 'the found link is queued for the crawler as a google link';
    END IF;

    -- a known link (the owner's) is queued for the crawler, and a pending crawl is not queued again
    DELETE FROM public.place_menu_crawl WHERE place_id = v_place;
    PERFORM public.request_place_crawl(v_place, v_name, v_link, 'owner');
    ASSERT public.enqueue_menu_build(v_place, v_name) = 'already_queued', 'a pending crawl is not queued again';

    -- 3. a crawl that found nothing is not retried before menuClickRetryDays, then it is
    UPDATE public.place_menu_crawl SET status = 'crawling', claimed_at = NOW() WHERE place_id = v_place;
    PERFORM public.finish_place_crawl(v_place, v_link, 'no_items', 'no dishes', 0);
    ASSERT public.enqueue_menu_build(v_place, v_name) = 'recently_tried', 'a restaurant tried recently is left alone';
    UPDATE public.place_menu_crawl SET finished_at = NOW() - INTERVAL '31 days' WHERE place_id = v_place;
    ASSERT public.enqueue_menu_build(v_place, v_name) = 'queued', 'after the retry days it is queued again';
    ASSERT (SELECT status FROM public.place_menu_crawl WHERE place_id = v_place) = 'pending', 'and is pending';

    -- 4. an owner's or an admin's link is never replaced by a found link
    DELETE FROM public.place_menu_crawl WHERE place_id = v_place;
    PERFORM public.request_place_crawl(v_place, v_name, v_link, 'owner');
    ASSERT public.request_place_crawl(v_place, v_name, 'https://other-118.example.com/menu', 'google') = 'owner_or_admin_link',
      'a found link does not replace the owner link';
    ASSERT (SELECT link FROM public.place_menu_crawl WHERE place_id = v_place) = v_link, 'the owner link is kept';
    ASSERT public.request_place_crawl(v_place, v_name, v_link, 'nobody') = 'invalid', 'an unknown source is refused';

    IF v_has_disc THEN
      -- 5. no usable link found: recorded once, not looked up again before the retry days
      DELETE FROM public.place_menu_crawl WHERE place_id = v_place;
      DELETE FROM public.place_menu_discovery WHERE place_id = v_place;
      ASSERT public.enqueue_menu_build(v_place, v_name) = 'queued', 'queued for a lookup again';
      PERFORM public.claim_place_discoveries(10);
      ASSERT public.finish_place_discovery(v_place, 'none', NULL, 'no link') = 'none', 'nothing found is recorded';
      ASSERT public.enqueue_menu_build(v_place, v_name) = 'recently_tried', 'not looked up again soon';
      ASSERT NOT EXISTS (SELECT 1 FROM public.place_menu_crawl WHERE place_id = v_place), 'nothing is queued for the crawler';

      -- 6. a refused link (not a web address) counts as nothing found
      DELETE FROM public.place_menu_discovery WHERE place_id = v_place;
      ASSERT public.enqueue_menu_build(v_place, v_name) = 'queued', 'queued again';
      PERFORM public.claim_place_discoveries(10);
      ASSERT public.finish_place_discovery(v_place, 'found', 'javascript:alert(1)', NULL) = 'none', 'a bad link is refused';

      -- 7. a failing lookup is retried later, and gives up after the attempts
      DELETE FROM public.place_menu_discovery WHERE place_id = v_place;
      PERFORM public.enqueue_menu_build(v_place, v_name);
      PERFORM public.claim_place_discoveries(10);
      ASSERT public.finish_place_discovery(v_place, 'error', NULL, 'SerpApi down') = 'error', 'the first failure is retried';
      SELECT COUNT(*) INTO v_count FROM public.claim_place_discoveries(10);
      ASSERT NOT EXISTS (SELECT 1 FROM public.claim_place_discoveries(10) WHERE job_place_id = v_place), 'not handed out before 6 hours';
      UPDATE public.place_menu_discovery SET next_attempt_at = NOW() - INTERVAL '1 minute', attempts = 3 WHERE place_id = v_place;
      ASSERT public.finish_place_discovery(v_place, 'error', NULL, 'SerpApi down') = 'none', 'after the attempts it gives up';

      -- 8. the daily cap
      DELETE FROM public.place_menu_discovery WHERE place_id = v_place;
      UPDATE public.app_config SET value = '1' WHERE key = 'menuClickRequestsPerDay';
      INSERT INTO public.place_menu_discovery (place_id, restaurant_name) VALUES ('ChIJ_cap_fill_118_x', 'Cap Filler');
      ASSERT public.enqueue_menu_build(v_place, v_name) = 'daily_cap', 'the daily cap stops new lookups';
      UPDATE public.app_config SET value = '50' WHERE key = 'menuClickRequestsPerDay';

    END IF;

    -- 9. a restaurant that already has real items is not queued; AI guesses do not count
    IF v_has_disc THEN EXECUTE 'DELETE FROM public.place_menu_discovery'; END IF;
    INSERT INTO public.menu_items (
      item_id, restaurant_name, name, calories, protein_g, total_carbs_g, total_fat_g, saturated_fat_g, sodium_mg,
      is_verified, cached_at, place_id
    ) VALUES ('manual_test118_' || md5(v_place), v_name, 'Test118 Item', 100, 0, 0, 0, 0, 0, true, NOW(), v_place);
    ASSERT public.enqueue_menu_build(v_place, v_name) = 'already_built', 'a real menu is already built';

    RAISE EXCEPTION 'rollback_test_118';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_118' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 118 TESTS PASSED';
END $$;

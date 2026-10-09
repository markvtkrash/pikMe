-- Test for migration 105: the scheduled job for both kinds of menu build. Runs for real inside a transaction that is
-- rolled back, with a made-up server address and key so nothing can reach a real server (the queued requests are
-- discarded with the rollback). The admin functions need a logged-in admin, so they are checked from their text.
-- Requires migrations 087, 097, 101, 102 and 105. Success: no error (Notices show PASS lines).
BEGIN;

INSERT INTO public.cached_restaurants (place_id, name) VALUES
  ('ChIJzzq8placeAAAAAAAAAAA1', 'ZZ Q8 Cafe'),
  ('ChIJzzq8placeBBBBBBBBBBB2', 'ZZ Q8 Bistro'),
  ('ChIJzzq8placeCCCCCCCCCCC3', 'ZZ Q8 Diner');

DO $$
DECLARE
  a CONSTANT TEXT := 'ChIJzzq8placeAAAAAAAAAAA1';
  b CONSTANT TEXT := 'ChIJzzq8placeBBBBBBBBBBB2';
  c CONSTANT TEXT := 'ChIJzzq8placeCCCCCCCCCCC3';
  run JSONB;
  n INTEGER;
  cron_def TEXT;
BEGIN
  -- nothing starts without the key
  DELETE FROM public.internal_settings WHERE key IN ('functions_url', 'service_key');
  run := public.run_scheduled_menu_builds();
  ASSERT run = jsonb_build_object('chains', 0, 'places', 0), 'nothing starts without the key. Got ' || run::text;
  RAISE NOTICE 'PASS: no key, nothing starts';

  INSERT INTO public.internal_settings (key, value) VALUES
    ('functions_url', 'http://127.0.0.1:9/functions/v1'),
    ('service_key', 'test-key-not-real-0123456789')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  -- keep any real queue jobs out of this test (rolled back with everything else)
  PERFORM public.enqueue_menu_build(a, 'ZZ Q8 Cafe');
  PERFORM public.enqueue_menu_build(b, 'ZZ Q8 Bistro');
  PERFORM public.enqueue_menu_build(c, 'ZZ Q8 Diner');
  UPDATE public.menu_build_queue SET status = 'needs_attention', next_attempt_at = 'infinity', started_at = NOW() - INTERVAL '3 days'
    WHERE place_id IS NULL OR place_id NOT IN (a, b, c);

  -- the per-run limit
  UPDATE public.app_config SET value = '2' WHERE key = 'placeMenuBuildsPerRun';
  UPDATE public.app_config SET value = '50' WHERE key = 'placeMenuBuildsPerDay';
  n := public._start_place_builds_capped('test');
  ASSERT n = 2, 'the per-run limit holds: 2 of the 3 waiting places start. Got ' || n;
  ASSERT (SELECT COUNT(*) FROM public.menu_build_queue WHERE place_id IN (a, b, c) AND status = 'building') = 2, 'two are building';
  RAISE NOTICE 'PASS: the per-run limit holds';

  -- the daily cap sits on top of it: 2 started already, so a cap of 3 allows exactly one more
  UPDATE public.app_config SET value = '3' WHERE key = 'placeMenuBuildsPerDay';
  UPDATE public.app_config SET value = '5' WHERE key = 'placeMenuBuildsPerRun';
  n := public._start_place_builds_capped('test');
  ASSERT n = 1, 'only the cap''s remainder starts (3 - 2 = 1). Got ' || n;
  n := public._start_place_builds_capped('test');
  ASSERT n = 0, 'nothing more once the daily cap is reached';
  UPDATE public.app_config SET value = '0' WHERE key = 'placeMenuBuildsPerDay';
  UPDATE public.menu_build_queue SET status = 'waiting', next_attempt_at = NOW() WHERE place_id = c;
  ASSERT public._start_place_builds_capped('test') = 0, 'a daily cap of 0 pauses the independents';
  RAISE NOTICE 'PASS: the daily cap holds';

  -- the scheduled entry point returns both counts
  UPDATE public.app_config SET value = '50' WHERE key = 'placeMenuBuildsPerDay';
  run := public.run_scheduled_menu_builds();
  ASSERT run->'chains' IS NOT NULL AND run->'places' IS NOT NULL, 'it reports chains and places. Got ' || run::text;
  RAISE NOTICE 'PASS: the scheduled run covers both';

  -- the admin functions (checked from their text: they need a logged-in admin)
  ASSERT pg_get_functiondef('public.admin_chain_build_status()'::regprocedure) ILIKE '%places_waiting bigint%'
     AND pg_get_functiondef('public.admin_chain_build_status()'::regprocedure) ILIKE '%place_per_day integer%', 'the status reports the place limits and queue counts';
  ASSERT pg_get_functiondef('public.admin_set_place_builds_per_run(integer)'::regprocedure) ILIKE '%_require_admin%', 'the per-run setter is admin-only';
  ASSERT pg_get_functiondef('public.admin_set_place_builds_per_run(integer)'::regprocedure) ILIKE '%> 20%', 'and capped at 20';
  ASSERT pg_get_functiondef('public.admin_set_place_builds_per_day(integer)'::regprocedure) ILIKE '%> 1000%', 'the daily cap is bounded';
  ASSERT pg_get_functiondef('public.admin_list_chain_build_log(integer)'::regprocedure) ILIKE '%UNION ALL%'
     AND pg_get_functiondef('public.admin_list_chain_build_log(integer)'::regprocedure) ILIKE '%kind text%', 'the recent builds list covers chains and independents';
  ASSERT has_function_privilege('authenticated', 'public.admin_set_place_builds_per_day(integer)', 'EXECUTE'), 'callable when signed in';
  ASSERT NOT has_function_privilege('anon', 'public.admin_set_place_builds_per_day(integer)', 'EXECUTE'), 'not by anon';
  ASSERT NOT has_function_privilege('authenticated', 'public.run_scheduled_menu_builds()', 'EXECUTE'), 'the scheduled entry point is not callable from the apps';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.proname = '_start_place_builds_capped' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ), 'nor is the runner';
  RAISE NOTICE 'PASS: admin functions';

  -- the schedule (only where pg_cron is installed)
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT schedule || '' | '' || command FROM cron.job WHERE jobname = ''chain-menu-builds''' INTO cron_def;
    ASSERT cron_def IS NOT NULL, 'the scheduled job exists';
    ASSERT cron_def LIKE '7,37 * * * *%', 'it runs at minutes 7 and 37. Got ' || cron_def;
    ASSERT cron_def LIKE '%run_scheduled_menu_builds%', 'and runs the combined entry point. Got ' || cron_def;
    RAISE NOTICE 'PASS: the schedule is every 30 minutes, both kinds';
  ELSE
    RAISE NOTICE 'SKIPPED: pg_cron is not installed, so the schedule was not checked';
  END IF;

  RAISE NOTICE 'ALL 105 TESTS PASSED';
END $$;

ROLLBACK;

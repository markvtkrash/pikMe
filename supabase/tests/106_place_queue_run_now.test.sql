-- Test for migration 106: "Run now" for independent restaurants only. Runs for real inside a transaction that is
-- rolled back, with a made-up server address and key so nothing can reach a real server. The admin button needs a
-- logged-in admin, so it is checked from its text. Requires migrations 101, 102, 105 and 106. Success: no error.
BEGIN;

INSERT INTO public.cached_restaurants (place_id, name) VALUES
  ('ChIJzzq9placeAAAAAAAAAAA1', 'ZZ Q9 Cafe'),
  ('ChIJzzq9placeBBBBBBBBBBB2', 'ZZ Q9 Bistro');

DO $$
DECLARE
  a CONSTANT TEXT := 'ChIJzzq9placeAAAAAAAAAAA1';
  b CONSTANT TEXT := 'ChIJzzq9placeBBBBBBBBBBB2';
BEGIN
  INSERT INTO public.internal_settings (key, value) VALUES
    ('functions_url', 'http://127.0.0.1:9/functions/v1'),
    ('service_key', 'test-key-not-real-0123456789')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  PERFORM public.enqueue_menu_build(a, 'ZZ Q9 Cafe');
  PERFORM public.enqueue_menu_build(b, 'ZZ Q9 Bistro');
  UPDATE public.menu_build_queue SET status = 'needs_attention', next_attempt_at = 'infinity', started_at = NOW() - INTERVAL '3 days'
    WHERE place_id IS NULL OR place_id NOT IN (a, b);

  UPDATE public.app_config SET value = '1' WHERE key = 'placeMenuBuildsPerRun';
  UPDATE public.app_config SET value = '0' WHERE key = 'placeMenuBuildsPerDay';

  -- the scheduled run applies the daily cap (0 = nothing) ...
  ASSERT public._start_place_builds_capped('test') = 0, 'the scheduled run obeys the daily cap';
  ASSERT public._start_place_builds_capped('test', TRUE) = 0, 'and so does an explicit request for it';
  -- ... a manual run does not, and still obeys the per-run limit
  ASSERT public._start_place_builds_capped('test', FALSE) = 1, 'a manual run starts the per-run limit even with the cap at 0';
  ASSERT (SELECT COUNT(*) FROM public.menu_build_queue WHERE place_id IN (a, b) AND status = 'building') = 1, 'one restaurant is building';
  RAISE NOTICE 'PASS: a manual run skips the daily cap, not the per-run limit';

  -- only independents: a queued franchise is left for the franchise run
  INSERT INTO public.franchise_chains (name, aliases) VALUES ('ZZ Q9 Chain', ARRAY[]::text[]);
  INSERT INTO public.cached_restaurants (place_id, name) VALUES ('ChIJzzq9placeCCCCCCCCCCC3', 'ZZ Q9 Chain');
  PERFORM public.enqueue_menu_build('ChIJzzq9placeCCCCCCCCCCC3', 'ZZ Q9 Chain');
  UPDATE public.app_config SET value = '5' WHERE key = 'placeMenuBuildsPerRun';
  PERFORM public._start_place_builds_capped('test', FALSE);
  ASSERT (SELECT status FROM public.menu_build_queue WHERE restaurant_name = 'ZZ Q9 Chain') = 'waiting', 'a franchise job is not started by the restaurant run';
  RAISE NOTICE 'PASS: the restaurant run starts independents only';

  -- access
  ASSERT pg_get_functiondef('public.admin_run_place_queue_now()'::regprocedure) ILIKE '%_require_admin%', 'the button is admin-only';
  ASSERT has_function_privilege('authenticated', 'public.admin_run_place_queue_now()', 'EXECUTE'), 'callable when signed in';
  ASSERT NOT has_function_privilege('anon', 'public.admin_run_place_queue_now()', 'EXECUTE'), 'not callable by anon';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.proname = '_start_place_builds_capped' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ), 'the runner is not callable from the apps';

  RAISE NOTICE 'ALL 106 TESTS PASSED';
END $$;

ROLLBACK;

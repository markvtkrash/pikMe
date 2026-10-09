-- Test for migration 102: starting the menu queue's jobs. Runs for real inside a transaction that is rolled
-- back, with a made-up server address and key so nothing can reach a real server (the queued requests are discarded
-- with the rollback). The admin button needs a logged-in admin, so it is checked from the function text.
-- Requires migrations 087, 100, 101 and 102. Success: no error.
BEGIN;

INSERT INTO public.cached_restaurants (place_id, name) VALUES
  ('ChIJzzq4placeAAAAAAAAAAA1', 'ZZ Q4 Cafe'),
  ('ChIJzzq4placeBBBBBBBBBBB2', 'ZZ Q4 Bistro');

DO $$
DECLARE
  a CONSTANT TEXT := 'ChIJzzq4placeAAAAAAAAAAA1';
  b CONSTANT TEXT := 'ChIJzzq4placeBBBBBBBBBBB2';
  run JSONB;
  n INTEGER;
BEGIN
  -- replacing a place's pulled items keeps verified ones and swaps the rest in one step
  INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, place_id) VALUES
    ('manual_zzq4_keep', 'ZZ Q4 Cafe', 'Owner Dish', true, a),
    ('pull_zzq4_old', 'ZZ Q4 Cafe', 'Old Pulled Dish', false, a);
  n := public.replace_place_pulled_items(a, 'ZZ Q4 Cafe', jsonb_build_array(
    jsonb_build_object('itemId', 'pull_new1', 'name', 'New Pulled Dish', 'calories', 300, 'isVerified', false)
  ));
  ASSERT n = 1, 'one new item saved';
  ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'manual_zzq4_keep'), 'the verified item stays';
  ASSERT NOT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'pull_zzq4_old'), 'the old pulled item is replaced';
  ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE place_id = a AND name = 'New Pulled Dish' AND is_verified = false), 'the new item is saved, unverified, for the place';
  RAISE NOTICE 'PASS: pulled items are swapped, verified ones stay';

  -- a failed save leaves the place's items as they were
  BEGIN
    PERFORM public.replace_place_pulled_items(a, 'ZZ Q4 Cafe', to_jsonb('not an array'::text));
    RAISE EXCEPTION 'a bad item list should have been refused';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE place_id = a AND name = 'New Pulled Dish'), 'a failed swap does not delete the earlier pulled items';
  RAISE NOTICE 'PASS: a failed swap changes nothing';

  -- the runner does nothing without the key
  DELETE FROM public.internal_settings WHERE key IN ('functions_url', 'service_key');
  PERFORM public.enqueue_menu_build(b, 'ZZ Q4 Bistro');
  run := public._start_menu_queue_builds('test');
  ASSERT run = jsonb_build_object('chains', 0, 'places', 0), 'nothing starts without the key';
  ASSERT (SELECT status FROM public.menu_build_queue WHERE place_id = b) = 'waiting', 'and the waiting job is left untouched';
  RAISE NOTICE 'PASS: no key, nothing starts';

  -- with a key (a made-up address, rolled back) it starts jobs and marks them building
  INSERT INTO public.internal_settings (key, value) VALUES
    ('functions_url', 'http://127.0.0.1:9/functions/v1'),
    ('service_key', 'test-key-not-real-0123456789')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  UPDATE public.menu_build_queue SET status = 'needs_attention', next_attempt_at = 'infinity'
    WHERE place_id IS DISTINCT FROM b OR place_id IS NULL;      -- keep any real jobs out of this test
  UPDATE public.app_config SET value = '3' WHERE key = 'placeMenuBuildsPerRun';
  run := public._start_menu_queue_builds('test');
  ASSERT (run->>'places')::int = 1, 'the waiting place job was started. Got ' || run::text;
  ASSERT (SELECT status FROM public.menu_build_queue WHERE place_id = b) = 'building', 'and marked building';
  run := public._start_menu_queue_builds('test');
  ASSERT (run->>'places')::int = 0, 'a building job is not started twice';
  RAISE NOTICE 'PASS: the queue starts jobs once';

  -- both limits at 0 pause everything
  UPDATE public.menu_build_queue SET status = 'waiting', next_attempt_at = NOW() WHERE place_id = b;
  UPDATE public.app_config SET value = '0' WHERE key IN ('placeMenuBuildsPerRun', 'chainMenuBuildsPerRun');
  run := public._start_menu_queue_builds('test');
  ASSERT run = jsonb_build_object('chains', 0, 'places', 0), 'a limit of 0 pauses the queue';
  RAISE NOTICE 'PASS: 0 pauses it';

  -- access
  ASSERT pg_get_functiondef('public.admin_run_menu_queue_now()'::regprocedure) ILIKE '%_require_admin%', 'the button is admin-only';
  ASSERT has_function_privilege('authenticated', 'public.admin_run_menu_queue_now()', 'EXECUTE'), 'callable when signed in';
  ASSERT NOT has_function_privilege('anon', 'public.admin_run_menu_queue_now()', 'EXECUTE'), 'not callable by anon';
  ASSERT NOT has_function_privilege('authenticated', 'public._start_menu_queue_builds(text)', 'EXECUTE'), 'the runner is not callable from the apps';
  ASSERT NOT has_function_privilege('authenticated', 'public.replace_place_pulled_items(text,text,jsonb)', 'EXECUTE'), 'neither is the swap';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'menu_build_queue' AND column_name = 'override_link'), 'the override link column exists';

  RAISE NOTICE 'ALL 102 TESTS PASSED';
END $$;

ROLLBACK;

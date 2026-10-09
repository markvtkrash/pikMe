-- Test for migration 097: the build log. The runner is exercised for real inside a transaction that is
-- rolled back, with a made-up server address and key so nothing can reach a real server (the queued
-- request is discarded with the rollback). The admin list needs a logged-in admin, so it is checked
-- from the catalog. Success: no error.
BEGIN;

INSERT INTO public.internal_settings (key, value) VALUES
  ('functions_url', 'http://127.0.0.1:9/functions/v1'),
  ('service_key', 'test-key-not-real-0123456789')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- builds per run must not be paused for this test (rolled back with everything else)
UPDATE public.app_config SET value = '3' WHERE key = 'chainMenuBuildsPerRun';

-- a chain that is eligible (a built-in page, never looked up), so the queue is never empty. Which chains
-- are picked also depends on how many others are waiting, so the test does not assume this one is chosen.
INSERT INTO public.franchise_chains (name, aliases, menu_url) VALUES ('ZZ Log Chain', ARRAY[]::text[], 'https://example.com/menu');

DO $$
DECLARE
  v_started INTEGER;
  v_logged  INTEGER;
  list_def  TEXT := pg_get_functiondef('public.admin_list_chain_build_log(integer)'::regprocedure);
BEGIN
  v_started := public._start_chain_menu_builds('test source');
  SELECT COUNT(*) INTO v_logged FROM public.chain_build_log WHERE source = 'test source';
  ASSERT v_started >= 1, 'the runner started at least one chain';
  ASSERT v_logged = v_started, 'every started chain is logged, once';
  ASSERT NOT EXISTS (SELECT 1 FROM public.chain_build_log WHERE source = 'test source' AND chain_name IS NULL),
    'every log row names its chain';

  -- old rows are removed on the next run
  INSERT INTO public.chain_build_log (started_at, chain_id, chain_name, source)
    SELECT NOW() - INTERVAL '40 days', id, name, 'old' FROM public.franchise_chains WHERE name = 'ZZ Log Chain';
  PERFORM public._start_chain_menu_builds('test source 2');
  ASSERT NOT EXISTS (SELECT 1 FROM public.chain_build_log WHERE source = 'old'), 'rows older than 30 days are removed';

  -- the scheduled job and "Run now" log their own source, and nothing starts without the key
  DELETE FROM public.internal_settings WHERE key IN ('functions_url', 'service_key');
  ASSERT public._start_chain_menu_builds('no key') = 0, 'nothing starts without the key';
  ASSERT public.run_chain_menu_builds() = 0, 'the scheduled entry point still works (and does nothing without the key)';

  -- admin list: admin-only, never anon, outcome logic present
  ASSERT list_def ILIKE '%_require_admin%', 'the list is admin-only';
  ASSERT list_def ILIKE '%no_result%' AND list_def ILIKE '%running%', 'outcomes: running / no_result are reported';
  ASSERT list_def ILIKE '%LIMIT 200%', 'the list is bounded';
  ASSERT has_function_privilege('authenticated', 'public.admin_list_chain_build_log(integer)', 'EXECUTE'), 'list callable when signed in';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_chain_build_log(integer)', 'EXECUTE'), 'list not callable by anon';
  ASSERT NOT has_function_privilege('authenticated', 'public._start_chain_menu_builds(text)', 'EXECUTE'), 'the runner is not callable from the app';
  ASSERT NOT has_table_privilege('authenticated', 'public.chain_build_log', 'SELECT'), 'the log table is not readable through the API';

  RAISE NOTICE 'ALL 097 TESTS PASSED';
END $$;

ROLLBACK;

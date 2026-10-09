-- Test for migration 089. The functions need a logged-in admin to run, which these
-- scripts don't fabricate, so this checks them from the catalog. Try the behaviour
-- on the admin Chain Menus page. Read-only. Success: no error.
DO $$
DECLARE
  status_def TEXT := pg_get_functiondef('public.admin_chain_build_status()'::regprocedure);
  set_def    TEXT := pg_get_functiondef('public.admin_set_chain_builds_per_run(integer)'::regprocedure);
  run_def    TEXT := pg_get_functiondef('public.admin_run_chain_builds_now()'::regprocedure);
BEGIN
  ASSERT status_def ILIKE '%_require_admin%' AND set_def ILIKE '%_require_admin%' AND run_def ILIKE '%_require_admin%',
    'all three are admin-only';
  ASSERT status_def ILIKE '%SECURITY DEFINER%' AND set_def ILIKE '%SECURITY DEFINER%' AND run_def ILIKE '%SECURITY DEFINER%',
    'all three are SECURITY DEFINER';

  -- the status never returns the key, and only reports whether it is stored
  ASSERT status_def NOT ILIKE '%service_key text%', 'the status has no column carrying the key';
  ASSERT status_def ILIKE '%configured boolean%', 'the status says whether the key is stored';
  ASSERT status_def ILIKE '%to_regclass(''cron.job'')%', 'it checks pg_cron is installed before touching cron.*';

  ASSERT set_def ILIKE '%> 20%', 'builds per run is capped at 20';
  ASSERT run_def ILIKE '%run_chain_menu_builds%', 'run now uses the same runner as the schedule';

  FOREACH status_def IN ARRAY ARRAY[
    'public.admin_chain_build_status()',
    'public.admin_set_chain_builds_per_run(integer)',
    'public.admin_run_chain_builds_now()'
  ] LOOP
    ASSERT has_function_privilege('authenticated', status_def, 'EXECUTE'), status_def || ' callable when signed in';
    ASSERT NOT has_function_privilege('anon', status_def, 'EXECUTE'), status_def || ' not callable by anon';
  END LOOP;

  RAISE NOTICE 'ALL 089 TESTS PASSED';
END $$;

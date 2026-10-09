-- Test for migration 099. Claimed restaurants need real owner accounts, which these scripts do not
-- fabricate, so the selection rules are checked from the function text, and the dry run is executed for
-- real against your data to confirm it reports without changing anything. Success: no error.
DO $$
DECLARE
  targets_def TEXT := pg_get_functiondef('public._menu_tie_targets()'::regprocedure);
  tie_def     TEXT := pg_get_functiondef('public.tie_menu_items_to_places(boolean)'::regprocedure);
  before_n    BIGINT;
  after_n     BIGINT;
  report      JSONB;
BEGIN
  -- selection rules
  ASSERT targets_def ILIKE '%is_franchise_chain%', 'franchise chains are never tied';
  ASSERT targets_def ILIKE '%status = ''approved''%', 'only approved claims';
  ASSERT targets_def ILIKE '%COUNT(*) FROM public.restaurants r2%', 'a name claimed more than once is skipped';
  ASSERT targets_def ILIKE '%has_others%' AND targets_def ILIKE '%is_verified%',
    'when other locations share the name, only verified items are tied';
  ASSERT targets_def ILIKE '%mi.place_id IS NULL%', 'items that already have a place are left alone';

  -- the real run logs what it changes, so it can be undone
  ASSERT tie_def ILIKE '%menu_items_place_tie_log%', 'every tied row is logged';
  ASSERT pg_get_functiondef('public.untie_menu_items_from_places()'::regprocedure) ILIKE '%menu_items_place_tie_log%', 'undo reads the log';

  -- not reachable from the apps
  ASSERT NOT has_function_privilege('anon', 'public.tie_menu_items_to_places(boolean)', 'EXECUTE'), 'anon cannot run it';
  ASSERT NOT has_function_privilege('authenticated', 'public.tie_menu_items_to_places(boolean)', 'EXECUTE'), 'signed-in users cannot run it';
  ASSERT NOT has_function_privilege('authenticated', 'public.untie_menu_items_from_places()', 'EXECUTE'), 'signed-in users cannot undo it';
  ASSERT NOT has_table_privilege('authenticated', 'public.menu_items_place_tie_log', 'SELECT'), 'the log is not readable through the API';

  -- the dry run reports and changes nothing
  SELECT COUNT(*) INTO before_n FROM public.menu_items WHERE place_id IS NOT NULL;
  report := public.tie_menu_items_to_places();
  SELECT COUNT(*) INTO after_n FROM public.menu_items WHERE place_id IS NOT NULL;
  ASSERT before_n = after_n, 'a dry run changes no rows';
  ASSERT (report->>'dryRun')::boolean = true, 'the default is a dry run';
  ASSERT (report->>'itemsTied')::int = 0, 'a dry run ties nothing';
  ASSERT (report->>'itemsToTie')::int = (report->>'verifiedItems')::int + (report->>'unverifiedItems')::int, 'the counts add up';
  ASSERT NOT EXISTS (SELECT 1 FROM public.menu_items_place_tie_log), 'a dry run logs nothing';

  RAISE NOTICE 'ALL 099 TESTS PASSED. Dry run report: %', report;
END $$;

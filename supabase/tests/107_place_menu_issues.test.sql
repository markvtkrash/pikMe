-- Test for migration 107: the independent-restaurant menu issues (report, override link, retry, owner message).
-- The functions need a logged-in admin or owner, which these scripts do not fabricate, so they are checked from their
-- text and from the access rules; the queue rows they work on are real (inside a transaction that is rolled back).
-- Requires migrations 101, 102 and 107. Success: no error (Notices show PASS lines).
BEGIN;

INSERT INTO public.cached_restaurants (place_id, name, address, city) VALUES
  ('ChIJzzqAplaceAAAAAAAAAAA1', 'ZZ QA Cafe', '1 Main St', 'Overland Park');

DO $$
DECLARE
  report_def TEXT := pg_get_functiondef('public.admin_list_place_menu_issues()'::regprocedure);
  link_def   TEXT := pg_get_functiondef('public.admin_set_place_override_link(bigint,text)'::regprocedure);
  retry_def  TEXT := pg_get_functiondef('public.admin_requeue_place_build(bigint)'::regprocedure);
  owner_def  TEXT := pg_get_functiondef('public.owner_menu_build_status()'::regprocedure);
BEGIN
  -- the report: admin-only, independents only, failed and flagged jobs, busiest first
  ASSERT report_def ILIKE '%_require_admin%', 'the report is admin-only';
  ASSERT report_def ILIKE '%q.kind = ''place''%', 'it lists independent restaurants only';
  ASSERT report_def ILIKE '%needs_attention%' AND report_def ILIKE '%no_menu_link%' AND report_def ILIKE '%unreadable%' AND report_def ILIKE '%''error''%',
    'it lists every failure state';
  ASSERT report_def ILIKE '%requested_count DESC%', 'the most-wanted come first';
  ASSERT report_def NOT ILIKE '%''building''%' AND report_def NOT ILIKE '%''built''%', 'running and built restaurants are not listed';

  -- the override link
  ASSERT link_def ILIKE '%_require_admin%', 'setting a link is admin-only';
  ASSERT link_def ILIKE '%full web address%', 'the link is checked';
  ASSERT link_def ILIKE '%status = ''waiting''%' AND link_def ILIKE '%attempts = 0%', 'saving a link puts the restaurant back in the queue';
  ASSERT retry_def ILIKE '%_require_admin%' AND retry_def ILIKE '%kind = ''place''%', 'retry is admin-only and for restaurants';

  -- the owner message: their own restaurant only, and not when real items exist
  ASSERT owner_def ILIKE '%r.owner_id = auth.uid()%', 'the owner sees only their own restaurant';
  ASSERT owner_def ILIKE '%NOT EXISTS%' AND owner_def ILIKE '%item_id NOT LIKE%', 'nothing is shown once the restaurant has real items';
  ASSERT owner_def ILIKE '%LIMIT 1%', 'one row at most';

  -- access
  ASSERT has_function_privilege('authenticated', 'public.admin_list_place_menu_issues()', 'EXECUTE'), 'the report is callable when signed in (the admin check is inside)';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_place_menu_issues()', 'EXECUTE'), 'not by anon';
  ASSERT NOT has_function_privilege('anon', 'public.admin_set_place_override_link(bigint,text)', 'EXECUTE'), 'anon cannot set a link';
  ASSERT NOT has_function_privilege('anon', 'public.admin_requeue_place_build(bigint)', 'EXECUTE'), 'anon cannot retry';
  ASSERT has_function_privilege('authenticated', 'public.owner_menu_build_status()', 'EXECUTE'), 'owners can ask about their restaurant';
  ASSERT NOT has_function_privilege('anon', 'public.owner_menu_build_status()', 'EXECUTE'), 'anon cannot';

  RAISE NOTICE 'ALL 107 TESTS PASSED';
END $$;

ROLLBACK;

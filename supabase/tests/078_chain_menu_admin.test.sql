-- Test for migration 078. The three admin functions call _require_admin() (they
-- need a logged-in admin, which these scripts don't fabricate), so this checks
-- what can be checked as the database owner: the new column and that the
-- functions exist with the expected signatures. Check the behaviour itself on the
-- admin app's Chain Menus page. Read-only. Success: no error.
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'franchise_menu_sources'
      AND column_name = 'menu_link_manual' AND data_type = 'boolean' AND is_nullable = 'NO'
  ), 'menu_link_manual column exists (boolean, not null)';
  ASSERT (
    SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'franchise_menu_sources' AND column_name = 'menu_link_manual'
  ) = 'false', 'menu_link_manual defaults to false';

  ASSERT to_regprocedure('public.admin_list_chain_menu_sources()') IS NOT NULL, 'admin_list_chain_menu_sources exists';
  ASSERT to_regprocedure('public.admin_set_chain_menu_link(uuid,text,text)') IS NOT NULL, 'admin_set_chain_menu_link exists';
  ASSERT to_regprocedure('public.admin_mark_chain_menu_stale(uuid)') IS NOT NULL, 'admin_mark_chain_menu_stale exists';

  -- Admin-only: each function must be SECURITY DEFINER and not callable by anon.
  ASSERT (SELECT bool_and(prosecdef) FROM pg_proc
          WHERE proname IN ('admin_list_chain_menu_sources', 'admin_set_chain_menu_link', 'admin_mark_chain_menu_stale')
            AND pronamespace = 'public'::regnamespace), 'admin functions are SECURITY DEFINER';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_chain_menu_sources()', 'EXECUTE'), 'anon cannot list';
  ASSERT NOT has_function_privilege('anon', 'public.admin_set_chain_menu_link(uuid,text,text)', 'EXECUTE'), 'anon cannot set a link';
  ASSERT NOT has_function_privilege('anon', 'public.admin_mark_chain_menu_stale(uuid)', 'EXECUTE'), 'anon cannot mark stale';
  ASSERT has_function_privilege('authenticated', 'public.admin_list_chain_menu_sources()', 'EXECUTE'), 'authenticated may call (admin check is inside)';

  RAISE NOTICE 'ALL 078 TESTS PASSED';
END $$;

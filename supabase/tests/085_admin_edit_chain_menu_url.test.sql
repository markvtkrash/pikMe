-- Test for migration 085. The admin functions need a logged-in admin to run, which
-- these scripts don't fabricate, so this checks them from the catalog: the list
-- function returns built_in_menu_url (last column) and is admin-only; the setter
-- exists, is admin-only, and keeps the address rules. Try the behaviour itself on the
-- admin Chain Menus page. Read-only. Success: no error.
DO $$
DECLARE
  list_def TEXT := pg_get_functiondef('public.admin_list_chain_menu_sources()'::regprocedure);
  set_def  TEXT := pg_get_functiondef('public.admin_set_chain_menu_url(uuid,text)'::regprocedure);
BEGIN
  -- list
  ASSERT list_def ILIKE '%built_in_menu_url text%', 'the list returns built_in_menu_url';
  ASSERT list_def ILIKE '%fc.menu_url%', 'it reads the chain''s menu_url';
  ASSERT position('current_items bigint' IN list_def) < position('built_in_menu_url text' IN list_def),
    'the new column is last';
  ASSERT list_def ILIKE '%_require_admin%', 'the list is admin-only';
  ASSERT list_def ILIKE '%SECURITY DEFINER%', 'the list is SECURITY DEFINER';

  -- setter
  ASSERT set_def ILIKE '%_require_admin%', 'the setter is admin-only';
  ASSERT set_def ILIKE '%SECURITY DEFINER%', 'the setter is SECURITY DEFINER';
  ASSERT set_def ILIKE '%UPDATE public.franchise_chains SET menu_url%', 'the setter updates menu_url';
  ASSERT set_def NOT ILIKE '%franchise_menu_sources%', 'the setter does not touch lookups (it must not mark the chain due)';
  ASSERT set_def ILIKE '%full web address%', 'the setter checks the address';

  -- access: signed-in users only (the admin check is inside), never anon
  ASSERT has_function_privilege('authenticated', 'public.admin_list_chain_menu_sources()', 'EXECUTE'), 'list callable when signed in';
  ASSERT has_function_privilege('authenticated', 'public.admin_set_chain_menu_url(uuid,text)', 'EXECUTE'), 'setter callable when signed in';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_chain_menu_sources()', 'EXECUTE'), 'anon cannot list';
  ASSERT NOT has_function_privilege('anon', 'public.admin_set_chain_menu_url(uuid,text)', 'EXECUTE'), 'anon cannot set';

  RAISE NOTICE 'ALL 085 TESTS PASSED';
END $$;

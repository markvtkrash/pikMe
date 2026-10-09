-- Test for migration 093. The three admin functions need a logged-in admin to run, which
-- these scripts don't fabricate, so they are checked from the catalog; the helper functions
-- are tested for real. Try the review list on the admin Franchise Menu Management page.
-- Read-only. Success: no error.
DO $$
DECLARE
  list_def    TEXT := pg_get_functiondef('public.admin_list_chain_link_suggestions()'::regprocedure);
  approve_def TEXT := pg_get_functiondef('public.admin_approve_chain_link_suggestion(uuid,text)'::regprocedure);
  dismiss_def TEXT := pg_get_functiondef('public.admin_dismiss_chain_link_suggestion(uuid,text)'::regprocedure);
  f TEXT;
BEGIN
  -- helpers
  ASSERT public.normalize_menu_link('  https://x.com/menu/#top ') = 'https://x.com/menu', 'fragment and trailing slash removed';
  ASSERT public.normalize_menu_link('https://x.com/') = 'https://x.com', 'bare site slash removed';
  ASSERT public.normalize_menu_link('https://x.com/menu?a=1') = 'https://x.com/menu?a=1', 'query kept';
  ASSERT public.normalize_menu_link('   ') IS NULL AND public.normalize_menu_link(NULL) IS NULL, 'blank is null';
  ASSERT public.menu_link_host('https://WWW.Example.com/menu?x=1') = 'example.com', 'host lowercased, www removed';
  ASSERT public.menu_link_host('https://order.example.com:8080/a') = 'order.example.com', 'port dropped, subdomain kept';
  ASSERT public.menu_link_host('not a link') IS NULL, 'no host in a non-link';
  ASSERT public.menu_hosts_match('example.com', 'example.com') = true, 'same host matches';
  ASSERT public.menu_hosts_match('order.example.com', 'example.com') = true, 'subdomain matches';
  ASSERT public.menu_hosts_match('example.com', 'order.example.com') = true, 'matches the other way round';
  ASSERT public.menu_hosts_match('badexample.com', 'example.com') = false, 'a host that merely ends the same does not match';
  ASSERT public.menu_hosts_match('example.com', 'other.com') = false, 'different hosts do not match';
  ASSERT public.menu_hosts_match(NULL, 'example.com') IS NULL, 'unknown is null';

  -- admin functions
  FOREACH f IN ARRAY ARRAY[list_def, approve_def, dismiss_def] LOOP
    ASSERT f ILIKE '%_require_admin%', 'admin-only';
    ASSERT f ILIKE '%SECURITY DEFINER%', 'SECURITY DEFINER';
  END LOOP;
  ASSERT list_def ILIKE '%menu_url IS NULL%', 'only chains with no built-in page are listed';
  ASSERT list_def ILIKE '%chain_link_dismissals%', 'dismissed links are left out';
  ASSERT approve_def ILIKE '%menu_url IS NULL%', 'approve only fills an empty page, never overwrites';
  ASSERT approve_def ILIKE '%no longer suggested%', 'approve only accepts a link owners have saved';

  ASSERT has_function_privilege('authenticated', 'public.admin_list_chain_link_suggestions()', 'EXECUTE'), 'list callable when signed in';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_chain_link_suggestions()', 'EXECUTE'), 'list not callable by anon';
  ASSERT NOT has_function_privilege('anon', 'public.admin_approve_chain_link_suggestion(uuid,text)', 'EXECUTE'), 'approve not callable by anon';
  ASSERT NOT has_function_privilege('anon', 'public.admin_dismiss_chain_link_suggestion(uuid,text)', 'EXECUTE'), 'dismiss not callable by anon';
  ASSERT NOT has_table_privilege('authenticated', 'public.chain_link_dismissals', 'SELECT'), 'the dismissals table is not readable through the API';

  RAISE NOTICE 'ALL 093 TESTS PASSED';
END $$;

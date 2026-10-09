-- Test for migration 094. The admin functions need a logged-in admin to run, which these
-- scripts don't fabricate, so they are checked from the catalog. Try the behaviour on the
-- admin Franchise Menu Management page. Read-only. Success: no error.
DO $$
DECLARE
  list_def    TEXT := pg_get_functiondef('public.admin_list_chain_link_suggestions()'::regprocedure);
  replace_def TEXT := pg_get_functiondef('public.admin_replace_chain_link_suggestion(uuid,text,text)'::regprocedure);
  approve_def TEXT := pg_get_functiondef('public.admin_approve_chain_link_suggestion(uuid,text)'::regprocedure);
BEGIN
  -- list: also chains that already have a page, when it differs; current page is the last column
  ASSERT list_def ILIKE '%current_menu_url text%', 'the list returns current_menu_url';
  ASSERT list_def ILIKE '%IS DISTINCT FROM%', 'a suggestion equal to the current page is not listed';
  ASSERT position('chain_website text' IN list_def) < position('current_menu_url text' IN list_def), 'the new column is last';
  ASSERT list_def ILIKE '%_require_admin%', 'the list is admin-only';
  ASSERT list_def ILIKE '%chain_link_dismissals%', 'dismissed links are still left out';

  -- replace: admin-only, explicit, never accidental
  ASSERT replace_def ILIKE '%_require_admin%', 'replace is admin-only';
  ASSERT replace_def ILIKE '%SECURITY DEFINER%', 'replace is SECURITY DEFINER';
  ASSERT replace_def ILIKE '%no longer suggested%', 'only a link owners saved can be used';
  ASSERT replace_def ILIKE '%p_expected_current%', 'the admin must pass the page they saw';
  ASSERT replace_def ILIKE '%changed since you opened this list%', 'refuses when the page changed meanwhile';
  ASSERT replace_def ILIKE '%FOR UPDATE%', 'locks the chain row while checking and replacing';

  -- approve is unchanged: still fills only an empty page
  ASSERT approve_def ILIKE '%menu_url IS NULL%', 'approve still fills only an empty page';

  ASSERT has_function_privilege('authenticated', 'public.admin_replace_chain_link_suggestion(uuid,text,text)', 'EXECUTE'), 'replace callable when signed in';
  ASSERT NOT has_function_privilege('anon', 'public.admin_replace_chain_link_suggestion(uuid,text,text)', 'EXECUTE'), 'replace not callable by anon';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_chain_link_suggestions()', 'EXECUTE'), 'list not callable by anon';

  RAISE NOTICE 'ALL 094 TESTS PASSED';
END $$;

-- Test for migration 095. The admin functions need a logged-in admin to run, which these
-- scripts don't fabricate, so they are checked from the catalog. Try the behaviour on the admin
-- Franchise Menu Management page (the chain's row shows "due for a new lookup" afterwards).
-- Read-only. Success: no error.
DO $$
DECLARE
  approve_def TEXT := pg_get_functiondef('public.admin_approve_chain_link_suggestion(uuid,text)'::regprocedure);
  replace_def TEXT := pg_get_functiondef('public.admin_replace_chain_link_suggestion(uuid,text,text)'::regprocedure);
BEGIN
  -- both mark the chain due, the same way "Refresh on next visit" does
  ASSERT approve_def ILIKE '%400 days%' AND approve_def ILIKE '%franchise_menu_sources%', 'approve marks the chain due';
  ASSERT replace_def ILIKE '%400 days%' AND replace_def ILIKE '%franchise_menu_sources%', 'replace marks the chain due';

  -- replace clears a stored link that is only the old built-in page, never a hand-set one
  ASSERT replace_def ILIKE '%menu_link = NULL%', 'replace clears the learned old built-in link';
  ASSERT replace_def ILIKE '%NOT COALESCE(menu_link_manual, false)%', 'a hand-set link is never cleared';
  ASSERT replace_def ILIKE '%normalize_menu_link(v_current)%', 'only the link equal to the old built-in page is cleared';

  -- the earlier guarantees still hold
  ASSERT approve_def ILIKE '%menu_url IS NULL%', 'approve still fills only an empty page';
  ASSERT approve_def ILIKE '%no longer suggested%', 'approve only accepts a link owners saved';
  ASSERT replace_def ILIKE '%changed since you opened this list%', 'replace still refuses a changed page';
  ASSERT replace_def ILIKE '%FOR UPDATE%', 'replace still locks the chain row';
  ASSERT approve_def ILIKE '%_require_admin%' AND replace_def ILIKE '%_require_admin%', 'both admin-only';

  ASSERT has_function_privilege('authenticated', 'public.admin_replace_chain_link_suggestion(uuid,text,text)', 'EXECUTE'), 'replace callable when signed in';
  ASSERT NOT has_function_privilege('anon', 'public.admin_replace_chain_link_suggestion(uuid,text,text)', 'EXECUTE'), 'replace not callable by anon';
  ASSERT NOT has_function_privilege('anon', 'public.admin_approve_chain_link_suggestion(uuid,text)', 'EXECUTE'), 'approve not callable by anon';

  RAISE NOTICE 'ALL 095 TESTS PASSED';
END $$;

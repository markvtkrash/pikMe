-- Test for migration 096. The admin functions need a logged-in admin to run, which these
-- scripts don't fabricate, so they are checked from the catalog; the queue is tested for real
-- inside a rolled-back transaction. Try the Store section on the admin Franchise Menu
-- Management page. Success: no error.
BEGIN;

DO $$
DECLARE
  list_def TEXT := pg_get_functiondef('public.admin_list_chain_menu_sources()'::regprocedure);
  set_def  TEXT := pg_get_functiondef('public.admin_set_chain_place_id(uuid,text,text)'::regprocedure);
BEGIN
  -- list: the two new columns come last; everything older is still there
  ASSERT list_def ILIKE '%source_place_id text%' AND list_def ILIKE '%has_store boolean%', 'the list returns source_place_id and has_store';
  ASSERT position('built_in_menu_url text' IN list_def) < position('source_place_id text' IN list_def), 'new columns come after the built-in page';
  ASSERT position('source_place_id text' IN list_def) < position('has_store boolean' IN list_def), 'has_store is last';
  ASSERT list_def ILIKE '%_require_admin%', 'the list is admin-only';

  -- setter
  ASSERT set_def ILIKE '%_require_admin%' AND set_def ILIKE '%SECURITY DEFINER%', 'the setter is admin-only and SECURITY DEFINER';
  ASSERT set_def ILIKE '%400 days%', 'saving a store marks the chain due';
  ASSERT set_def ILIKE '%does not look like a Google place ID%', 'the place ID format is checked';
  ASSERT set_def ILIKE '%find_franchise_chain%', 'the store name is checked against the franchise list (a warning)';
  ASSERT has_function_privilege('authenticated', 'public.admin_set_chain_place_id(uuid,text,text)', 'EXECUTE'), 'callable when signed in';
  ASSERT NOT has_function_privilege('anon', 'public.admin_set_chain_place_id(uuid,text,text)', 'EXECUTE'), 'not callable by anon';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_chain_menu_sources()', 'EXECUTE'), 'list not callable by anon';
END $$;

-- the queue: a built-in menu page is now enough, with no store
INSERT INTO public.franchise_chains (name, aliases, menu_url) VALUES
  ('ZZ R Page Only', ARRAY[]::text[], 'https://example.com/menu'),
  ('ZZ R Nothing',   ARRAY[]::text[], NULL);

DO $$
DECLARE
  names TEXT[];
BEGIN
  SELECT COALESCE(array_agg(chain_name ORDER BY chain_name), '{}') INTO names
  FROM public.chains_needing_menu_build(1000, 30) WHERE chain_name LIKE 'ZZ R %';
  ASSERT names = ARRAY['ZZ R Page Only'], 'a chain with only a built-in page is queued; one with nothing is not. Got ' || names::text;
  ASSERT has_function_privilege('service_role', 'public.chains_needing_menu_build(integer,integer)', 'EXECUTE'), 'service role can call the queue';
  ASSERT NOT has_function_privilege('anon', 'public.chains_needing_menu_build(integer,integer)', 'EXECUTE'), 'anon cannot';
  RAISE NOTICE 'ALL 096 TESTS PASSED';
END $$;

ROLLBACK;

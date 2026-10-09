-- Test for migration 092. admin_add_franchise_chain needs a logged-in admin to run, which
-- these scripts don't fabricate. So this checks the function's definition from the catalog,
-- and exercises the rule it relies on (names that normalize alike collide) directly against
-- franchise_chains inside a transaction that is rolled back. Try the real thing on the admin
-- Franchise Menu Management page. Success: no error.
BEGIN;

DO $$
DECLARE
  def TEXT := pg_get_functiondef('public.admin_add_franchise_chain(text,text,text[],text)'::regprocedure);
BEGIN
  ASSERT def ILIKE '%_require_admin%', 'admin-only';
  ASSERT def ILIKE '%SECURITY DEFINER%', 'SECURITY DEFINER';
  ASSERT def ILIKE '%is already used by%', 'refuses a name or alias already on the list';
  ASSERT def ILIKE '%full web address%', 'checks the menu page address';
  ASSERT def ILIKE '%cardinality(v_aliases) > 20%', 'caps aliases at 20';
  ASSERT has_function_privilege('authenticated', 'public.admin_add_franchise_chain(text,text,text[],text)', 'EXECUTE'), 'callable when signed in';
  ASSERT NOT has_function_privilege('anon', 'public.admin_add_franchise_chain(text,text,text[],text)', 'EXECUTE'), 'not callable by anon';

  -- the rule it relies on: the normalized name is unique, so look-alikes collide
  INSERT INTO public.franchise_chains (name, aliases) VALUES ('ZZ Add Test Chain', ARRAY['ZZ Add Alias']);
  BEGIN
    INSERT INTO public.franchise_chains (name) VALUES ('zz add test chain #12');
    RAISE EXCEPTION 'a look-alike name should have been refused';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  ASSERT public.normalize_restaurant_name('ZZ Add Alias') = 'zz add alias', 'aliases normalize like names';
  ASSERT (SELECT id FROM public.find_franchise_chain('ZZ Add Alias')) = (SELECT id FROM public.franchise_chains WHERE name = 'ZZ Add Test Chain'),
    'a saved alias finds its chain';

  RAISE NOTICE 'ALL 092 TESTS PASSED';
END $$;

ROLLBACK;

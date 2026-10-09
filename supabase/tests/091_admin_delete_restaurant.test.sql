-- Test for migration 091. admin_delete_restaurant needs a logged-in admin to run, which
-- these scripts don't fabricate, so this checks it from the catalog, plus the foreign
-- keys it relies on to cascade. Try the behaviour on the admin Manage Restaurants page
-- (a dry run changes nothing). Read-only. Success: no error.
DO $$
DECLARE
  def TEXT := pg_get_functiondef('public.admin_delete_restaurant(uuid,boolean)'::regprocedure);
  t TEXT;
BEGIN
  ASSERT def ILIKE '%_require_admin%', 'admin-only';
  ASSERT def ILIKE '%SECURITY DEFINER%', 'SECURITY DEFINER';
  ASSERT def ILIKE '%Close the restaurant before deleting it%', 'only a closed restaurant can be deleted';
  ASSERT def ILIKE '%p_dry_run%', 'has a dry run';
  ASSERT def ILIKE '%is_franchise_chain%', 'a chain''s shared menu is never deleted';
  ASSERT def NOT ILIKE '%delete from public.restaurant_owners%', 'the owner account is kept';
  ASSERT def NOT ILIKE '%delete from public.cached_restaurants%', 'the public listing is kept';
  ASSERT has_function_privilege('authenticated', 'public.admin_delete_restaurant(uuid,boolean)', 'EXECUTE'), 'callable when signed in';
  ASSERT NOT has_function_privilege('anon', 'public.admin_delete_restaurant(uuid,boolean)', 'EXECUTE'), 'not callable by anon';

  -- Every table with a foreign key onto restaurants must cascade (or be one this function handles),
  -- otherwise the delete would fail on a restriction. A new table added later fails this on purpose.
  FOR t IN
    SELECT conrelid::regclass::text
    FROM pg_constraint
    WHERE confrelid = 'public.restaurants'::regclass AND contype = 'f' AND confdeltype <> 'c'
  LOOP
    RAISE EXCEPTION 'table % references restaurants without ON DELETE CASCADE: admin_delete_restaurant must handle it', t;
  END LOOP;

  RAISE NOTICE 'ALL 091 TESTS PASSED';
END $$;

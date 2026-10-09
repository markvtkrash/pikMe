-- Test for migration 090: admin_list_owners keeps its admin-only check and its earlier
-- columns, and now also returns the restaurant's address as its last column. The
-- function needs a logged-in admin to run, so this checks the definition from the
-- catalog; check the display on the admin Manage Restaurants page. Read-only.
-- Success: no error.
DO $$
DECLARE
  def TEXT := pg_get_functiondef('public.admin_list_owners()'::regprocedure);
BEGIN
  ASSERT def ILIKE '%SECURITY DEFINER%', 'admin_list_owners is SECURITY DEFINER';
  ASSERT def LIKE '%Only admins can list owners%', 'still refuses non-admins';
  ASSERT def ILIKE '%restaurant_address text%', 'returns restaurant_address';
  ASSERT def ILIKE '%r.address%', 'reads it from the restaurants table';
  ASSERT def ILIKE '%google_place_id text%', 'still returns google_place_id (083)';
  ASSERT position('google_place_id text' IN def) < position('restaurant_address text' IN def),
    'the new column comes last';
  ASSERT has_function_privilege('authenticated', 'public.admin_list_owners()', 'EXECUTE'), 'callable by signed-in users (admin check is inside)';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_owners()', 'EXECUTE'), 'not callable by anon';
  RAISE NOTICE 'ALL 090 TESTS PASSED';
END $$;

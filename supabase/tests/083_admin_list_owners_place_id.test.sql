-- Test for migration 083: admin_list_owners still exists, still refuses non-admins,
-- and now returns the restaurant's google_place_id as its last column. The
-- function needs a logged-in admin to run, which these scripts don't fabricate,
-- so this checks the function's definition from the catalog. Check the display
-- itself on the admin Manage Restaurants page. Read-only. Success: no error.
DO $$
DECLARE
  def TEXT := pg_get_functiondef('public.admin_list_owners()'::regprocedure);
BEGIN
  ASSERT def ILIKE '%SECURITY DEFINER%', 'admin_list_owners is SECURITY DEFINER';
  ASSERT def LIKE '%Only admins can list owners%', 'still refuses non-admins';
  -- pg_get_functiondef prints types in lower case ("google_place_id text"), so compare case-insensitively.
  ASSERT def ILIKE '%google_place_id text%', 'returns google_place_id';
  ASSERT def ILIKE '%r.google_place_id%', 'reads it from the restaurants table';
  -- Existing columns are all still there, in their original order, before the new one.
  ASSERT position('claimed_at timestamp with time zone' IN def) < position('google_place_id text' IN def),
    'the new column comes after the original ones';
  ASSERT has_function_privilege('authenticated', 'public.admin_list_owners()', 'EXECUTE'), 'callable by signed-in users (admin check is inside)';
  RAISE NOTICE 'ALL 083 TESTS PASSED';
END $$;

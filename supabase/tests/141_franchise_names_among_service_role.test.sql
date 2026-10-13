-- Test for migration 141: the edge function's role (service_role) can ask which restaurant names are franchises. Needs migrations 126, 139 and 141.
-- Success: no error.
DO $$
BEGIN
  ASSERT has_function_privilege('service_role', 'public.franchise_names_among(text[])', 'EXECUTE'), 'service_role can run franchise_names_among';
  ASSERT has_function_privilege('authenticated', 'public.franchise_names_among(text[])', 'EXECUTE'), 'a signed-in customer still can';
  ASSERT has_table_privilege('service_role', 'public.app_config', 'SELECT'), 'service_role can read the admin switches in app_config';
  RAISE NOTICE 'ALL 141 TESTS PASSED';
END $$;

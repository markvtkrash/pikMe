-- Test for migration 127: the customer app's single config call and the minimum app version. Needs migration 127.
-- (Migration 128 gives the call an optional app version and adds the live announcements; this test passes before and after.)
-- Success: no error.
DO $$
DECLARE
  v_cfg JSONB;
BEGIN
  ASSERT has_function_privilege('anon', 'public.get_customer_config()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_customer_config(text)', 'EXECUTE'), 'readable before sign-in';
  ASSERT has_function_privilege('authenticated', 'public.get_customer_config()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.get_customer_config(text)', 'EXECUTE'), 'readable when signed in';

  ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'minAppVersion'), 'the minimum version setting exists';
  ASSERT (SELECT value FROM public.app_config WHERE key = 'minAppVersion') ~ '^[0-9]+(\.[0-9]+){0,2}$', 'it is a version number';

  v_cfg := public.get_customer_config();
  ASSERT v_cfg ? 'minAppVersion', 'the minimum version is included';

  -- only the whitelisted settings are exposed (migration 128 adds the live announcements to the same call)
  ASSERT NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(v_cfg) k
    WHERE k NOT IN ('maxRadiusMiles', 'showUnconfirmedMenuItems', 'minAppVersion', 'announcements', 'categories')
  ), 'nothing else from app_config is exposed';
  ASSERT NOT (v_cfg ? 'crawler_secret') AND NOT (v_cfg ? 'service_key'), 'no secrets';

  RAISE NOTICE 'ALL 127 TESTS PASSED';
END $$;

-- Test for migration 153: the linkExtractMaxTokens setting exists, is a valid number, and is described.
-- Read-only. Success: no error.
DO $$
DECLARE
  v_value TEXT;
BEGIN
  SELECT c.value INTO v_value FROM public.app_config c WHERE c.key = 'linkExtractMaxTokens';
  ASSERT v_value IS NOT NULL, 'the linkExtractMaxTokens row exists';
  ASSERT v_value ~ '^[0-9]{1,6}$', 'it holds a whole number';
  ASSERT v_value::INTEGER BETWEEN 1024 AND 32000, 'it is within the allowed range (1024 to 32000)';
  ASSERT (SELECT c.description FROM public.app_config c WHERE c.key = 'linkExtractMaxTokens') ILIKE '%extract-menu-from-link%', 'it has a description for the Config page';
  RAISE NOTICE 'ALL 153 TESTS PASSED';
END $$;

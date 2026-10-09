-- Test for migration 109: the textExtractMaxTokens setting exists, is a valid number, and is described.
-- Read-only. Success: no error.
DO $$
DECLARE
  v_value TEXT;
BEGIN
  SELECT c.value INTO v_value FROM public.app_config c WHERE c.key = 'textExtractMaxTokens';
  ASSERT v_value IS NOT NULL, 'the textExtractMaxTokens row exists';
  ASSERT v_value ~ '^[0-9]{1,6}$', 'it holds a whole number';
  ASSERT v_value::INTEGER BETWEEN 1024 AND 32000, 'it is within the allowed range (1024 to 32000)';
  ASSERT (SELECT c.description FROM public.app_config c WHERE c.key = 'textExtractMaxTokens') ILIKE '%pasted menu text%', 'it has a description for the Config page';
  RAISE NOTICE 'ALL 109 TESTS PASSED';
END $$;

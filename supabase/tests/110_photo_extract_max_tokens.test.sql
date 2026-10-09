-- Test for migration 110: the photoExtractMaxTokens setting exists, is a valid number, and is described.
-- Read-only. Success: no error.
DO $$
DECLARE
  v_value TEXT;
BEGIN
  SELECT c.value INTO v_value FROM public.app_config c WHERE c.key = 'photoExtractMaxTokens';
  ASSERT v_value IS NOT NULL, 'the photoExtractMaxTokens row exists';
  ASSERT v_value ~ '^[0-9]{1,6}$', 'it holds a whole number';
  ASSERT v_value::INTEGER BETWEEN 1024 AND 32000, 'it is within the allowed range (1024 to 32000)';
  ASSERT (SELECT c.description FROM public.app_config c WHERE c.key = 'photoExtractMaxTokens') ILIKE '%menu photo%', 'it has a description for the Config page';
  ASSERT EXISTS (SELECT 1 FROM public.app_config c WHERE c.key = 'textExtractMaxTokens'), 'the pasted-text setting (109) is a separate row';
  RAISE NOTICE 'ALL 110 TESTS PASSED';
END $$;

-- Test for migration 112: the menuGuessModel setting exists, is described, and is blank unless an admin has set it.
-- Read-only. Success: no error.
DO $$
DECLARE
  v_value TEXT;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.app_config c WHERE c.key = 'menuGuessModel'), 'the menuGuessModel row exists';
  SELECT c.value INTO v_value FROM public.app_config c WHERE c.key = 'menuGuessModel';
  ASSERT v_value IS NOT NULL, 'it is blank or a model name, never null';
  ASSERT v_value = '' OR v_value ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$', 'a set value is a plain model name';
  ASSERT (SELECT c.description FROM public.app_config c WHERE c.key = 'menuGuessModel') ILIKE '%guessed menu%', 'it has a description for the Config page';
  ASSERT EXISTS (SELECT 1 FROM public.app_config c WHERE c.key = 'menuGuessMaxTokens'), 'the reply-cap setting (111) is a separate row';
  RAISE NOTICE 'ALL 112 TESTS PASSED';
END $$;

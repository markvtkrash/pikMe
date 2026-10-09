-- Test for migration 115: the menuFromTextModel setting exists, is described, and is blank unless an admin has set it.
-- The shared quicksilverModel setting is untouched. Read-only. Success: no error.
DO $$
DECLARE
  v_value TEXT;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.app_config c WHERE c.key = 'menuFromTextModel'), 'the menuFromTextModel row exists';
  SELECT c.value INTO v_value FROM public.app_config c WHERE c.key = 'menuFromTextModel';
  ASSERT v_value IS NOT NULL, 'it is blank or a model name, never null';
  ASSERT v_value = '' OR v_value ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$', 'a set value is a plain model name';
  ASSERT (SELECT c.description FROM public.app_config c WHERE c.key = 'menuFromTextModel') ILIKE '%pasted menu text%', 'it has a description for the Config page';
  ASSERT EXISTS (SELECT 1 FROM public.app_config c WHERE c.key = 'quicksilverModel'), 'the shared quicksilverModel setting is still there';
  RAISE NOTICE 'ALL 115 TESTS PASSED';
END $$;

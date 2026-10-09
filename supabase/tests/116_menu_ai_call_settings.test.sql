-- Test for migration 116: the two AI-call settings exist, hold whole numbers within their allowed range, and are described.
-- Read-only. Success: no error.
DO $$
DECLARE
  v_batch   TEXT;
  v_timeout TEXT;
BEGIN
  SELECT c.value INTO v_batch   FROM public.app_config c WHERE c.key = 'menuNutritionBatchSize';
  SELECT c.value INTO v_timeout FROM public.app_config c WHERE c.key = 'menuAiTimeoutSeconds';

  ASSERT v_batch IS NOT NULL, 'the menuNutritionBatchSize row exists';
  ASSERT v_batch ~ '^[0-9]{1,6}$' AND v_batch::INTEGER BETWEEN 1 AND 50, 'the batch size is a whole number from 1 to 50';
  ASSERT (SELECT c.description FROM public.app_config c WHERE c.key = 'menuNutritionBatchSize') ILIKE '%nutrition call%', 'the batch size is described';

  ASSERT v_timeout IS NOT NULL, 'the menuAiTimeoutSeconds row exists';
  ASSERT v_timeout ~ '^[0-9]{1,6}$' AND v_timeout::INTEGER BETWEEN 5 AND 120, 'the timeout is a whole number from 5 to 120';
  ASSERT (SELECT c.description FROM public.app_config c WHERE c.key = 'menuAiTimeoutSeconds') ILIKE '%AI call%', 'the timeout is described';

  RAISE NOTICE 'ALL 116 TESTS PASSED';
END $$;

-- Test for migration 075: the chainMenuMaxItems config row exists with a usable
-- numeric value. Read-only (changes nothing). Success: no error.
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM public.app_config
    WHERE key = 'chainMenuMaxItems' AND value ~ '^[0-9]+$' AND value::int BETWEEN 5 AND 150
  ), 'chainMenuMaxItems config row exists with a numeric value 5-150';
  RAISE NOTICE 'ALL 075 TESTS PASSED';
END $$;

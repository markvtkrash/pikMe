-- Test for migration 079: the chainMenuModelParams setting exists, and the old
-- chainMenuExtraBody row it replaces is gone. Read-only. Success: no error.
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'chainMenuModelParams'), 'chainMenuModelParams row exists';
  ASSERT NOT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'chainMenuExtraBody'), 'old chainMenuExtraBody row is removed';
  ASSERT (SELECT value FROM public.app_config WHERE key = 'chainMenuModelParams') !~ '[{}]',
    'chainMenuModelParams holds name=value pairs, not JSON';
  RAISE NOTICE 'ALL 079 TESTS PASSED';
END $$;

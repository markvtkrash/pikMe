-- Test for migration 126: the franchise / independent display flags and the franchise-name lookup. Needs migrations 062 and 126.
-- Success: no error.
DO $$
DECLARE
  v_franchise TEXT;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'showFranchiseRestaurants'), 'the franchise flag exists';
  ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'showIndependentRestaurants'), 'the independent flag exists';
  ASSERT (SELECT value FROM public.app_config WHERE key = 'showFranchiseRestaurants') IN ('true', 'false'), 'the franchise flag is true or false';
  ASSERT (SELECT value FROM public.app_config WHERE key = 'showIndependentRestaurants') IN ('true', 'false'), 'the independent flag is true or false';

  ASSERT has_function_privilege('anon', 'public.franchise_names_among(text[])', 'EXECUTE'), 'the customer app can ask';

  -- a known franchise is returned, an unknown name is not, blanks and repeats are ignored
  SELECT fc.name INTO v_franchise FROM public.franchise_chains fc WHERE fc.is_active LIMIT 1;
  IF v_franchise IS NOT NULL THEN
    ASSERT EXISTS (SELECT 1 FROM public.franchise_names_among(ARRAY[v_franchise, 'Zzz Not A Franchise 126']) WHERE name = v_franchise),
      'a franchise name is returned';
    ASSERT NOT EXISTS (SELECT 1 FROM public.franchise_names_among(ARRAY[v_franchise, 'Zzz Not A Franchise 126']) WHERE name = 'Zzz Not A Franchise 126'),
      'an independent name is not returned';
    ASSERT (SELECT COUNT(*) FROM public.franchise_names_among(ARRAY[v_franchise, v_franchise, '  ', ''])) = 1,
      'repeats and blanks are ignored';
  END IF;
  ASSERT (SELECT COUNT(*) FROM public.franchise_names_among(ARRAY[]::TEXT[])) = 0, 'an empty list gives nothing';
  ASSERT (SELECT COUNT(*) FROM public.franchise_names_among(NULL)) = 0, 'no list gives nothing';

  RAISE NOTICE 'ALL 126 TESTS PASSED';
END $$;

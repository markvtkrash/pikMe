-- Test for migration 130: the category check runs with the function owner's rights, so an owner can save categories. Needs 129 and 130.
DO $$
BEGIN
  ASSERT (SELECT prosecdef FROM pg_proc WHERE proname = '_check_restaurant_categories' AND pronamespace = 'public'::regnamespace),
    'the category check is SECURITY DEFINER';
  ASSERT NOT has_function_privilege('anon', 'public._check_restaurant_categories()', 'EXECUTE'), 'anon cannot call it';
  ASSERT NOT has_table_privilege('authenticated', 'public.restaurant_categories', 'SELECT'), 'the table stays closed to direct reads';
  RAISE NOTICE 'ALL 130 TESTS PASSED';
END $$;

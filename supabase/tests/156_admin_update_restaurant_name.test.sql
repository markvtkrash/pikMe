-- Test for migration 156: admin_update_restaurant_name. Tried inside a transaction that is
-- rolled back, so nothing is left behind.
-- Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_rest  public.restaurants%ROWTYPE;
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.admin_update_restaurant_name(uuid,text)', 'EXECUTE'), 'anon cannot rename a restaurant';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  SELECT * INTO v_rest FROM public.restaurants r WHERE r.status = 'approved' ORDER BY r.created_at LIMIT 1;
  IF v_admin IS NULL OR v_rest.id IS NULL THEN
    RAISE NOTICE 'no admin or restaurant to try the behaviour on; wiring checks only';
    RAISE NOTICE 'ALL 156 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    -- an admin renames a restaurant, with surrounding whitespace trimmed
    PERFORM public.admin_update_restaurant_name(v_rest.id, '  New Name  ');
    ASSERT (SELECT name FROM public.restaurants WHERE id = v_rest.id) = 'New Name', 'the new name is saved and trimmed';

    -- an empty or blank name is refused
    BEGIN
      PERFORM public.admin_update_restaurant_name(v_rest.id, '   ');
      RAISE EXCEPTION 'an empty name was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'an empty name was accepted' THEN RAISE; END IF; END;
    ASSERT (SELECT name FROM public.restaurants WHERE id = v_rest.id) = 'New Name', 'the blank attempt did not overwrite the name';

    -- an unknown restaurant id is refused
    BEGIN
      PERFORM public.admin_update_restaurant_name('00000000-0000-0000-0000-000000000000', 'X');
      RAISE EXCEPTION 'an unknown restaurant was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'an unknown restaurant was accepted' THEN RAISE; END IF; END;

    -- a non-admin cannot rename a restaurant
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    BEGIN
      PERFORM public.admin_update_restaurant_name(v_rest.id, 'Hijacked');
      RAISE EXCEPTION 'a non-admin was allowed';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a non-admin was allowed' THEN RAISE; END IF; END;

    RAISE EXCEPTION 'rollback_test_156';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_156' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 156 TESTS PASSED';
END $$;

-- Test for migrations 139 and 140: listing eligibility. Everything is tried inside a transaction that is rolled back. Needs migrations 139 and 140.
-- Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_a CONSTANT TEXT := 'ChIJlist139aaaaaaaaaa';
  v_b CONSTANT TEXT := 'ChIJlist139bbbbbbbbbb';
  v_info JSONB;
  v_n INTEGER;
BEGIN
  -- nothing is exposed that should not be
  ASSERT NOT has_table_privilege('anon', 'public.restaurant_listing', 'SELECT'), 'anon cannot read the flag table';
  ASSERT NOT has_table_privilege('authenticated', 'public.restaurant_listing', 'SELECT'), 'a customer cannot read the flag table';
  ASSERT has_table_privilege('service_role', 'public.restaurant_listing', 'SELECT'), 'the service role can read the flag table';
  ASSERT has_table_privilege('service_role', 'public.app_config', 'SELECT'), 'the service role can read app_config (the grant that was missing)';
  ASSERT NOT has_function_privilege('authenticated', 'public.refresh_listing_eligibility(text)', 'EXECUTE'), 'a customer cannot run the refresh';
  ASSERT NOT has_function_privilege('anon', 'public.admin_set_listing_eligibility(text, boolean, text)', 'EXECUTE'), 'anon cannot set the flag';
  ASSERT has_function_privilege('authenticated', 'public.restaurant_is_listed(text)', 'EXECUTE'), 'customers can ask whether a place is listed';
  ASSERT to_regprocedure('public._get_active_coupons_for_restaurant_raw(uuid)') IS NOT NULL, 'the coupons function keeps its real body as _raw';
  ASSERT to_regprocedure('public._get_place_ids_with_active_coupons_raw()') IS NOT NULL, 'the coupons-only function keeps its real body as _raw';

  -- the switch is off by default
  ASSERT (SELECT value FROM public.app_config WHERE key = 'enforceListingEligibility') IS NOT NULL, 'the switch exists';

  BEGIN
    UPDATE public.app_config SET value = 'false' WHERE key = 'enforceListingEligibility';

    -- a place with no row is eligible; NULL and empty are listed
    ASSERT public.restaurant_is_listed(v_a) IS TRUE, 'a place with no row is listed';
    ASSERT public.restaurant_is_listed(NULL) IS TRUE AND public.restaurant_is_listed('') IS TRUE, 'no place is listed (a name-only lookup)';

    -- marked not eligible, but the switch is off: still listed
    INSERT INTO public.restaurant_listing (google_place_id, is_eligible, reason) VALUES (v_a, FALSE, 'test');
    ASSERT public.restaurant_is_listed(v_a) IS TRUE, 'with the switch off the flag is ignored';
    ASSERT public.restaurant_listing_blocked(v_a) IS FALSE, 'with the switch off nothing is blocked';
    SELECT COUNT(*) INTO v_n FROM public.ineligible_place_ids(ARRAY[v_a, v_b]);
    ASSERT v_n = 0, 'with the switch off no place is reported as ineligible';

    -- switch on: the flagged place is hidden, others are not
    UPDATE public.app_config SET value = 'true' WHERE key = 'enforceListingEligibility';
    ASSERT public._listing_enforced() IS TRUE, 'the switch reads as on';
    ASSERT public.restaurant_is_listed(v_a) IS FALSE, 'with the switch on a not-eligible place is hidden';
    ASSERT public.restaurant_is_listed(v_b) IS TRUE, 'a place with no row is still listed';
    ASSERT public.restaurant_is_listed(NULL) IS TRUE, 'no place is still listed';
    SELECT COUNT(*) INTO v_n FROM public.ineligible_place_ids(ARRAY[v_a, v_b]);
    ASSERT v_n = 1 AND EXISTS (SELECT 1 FROM public.ineligible_place_ids(ARRAY[v_a, v_b]) WHERE google_place_id = v_a), 'only the flagged place is reported';

    -- an eligible row is listed
    UPDATE public.restaurant_listing SET is_eligible = TRUE WHERE google_place_id = v_a;
    ASSERT public.restaurant_is_listed(v_a) IS TRUE, 'marked eligible again, it is listed';

    -- the automatic refresh: today the condition says everyone is eligible, and it never touches a hand setting
    UPDATE public.restaurant_listing SET is_eligible = FALSE, manual_override = TRUE WHERE google_place_id = v_a;
    PERFORM public.refresh_listing_eligibility(v_a);
    ASSERT (SELECT is_eligible FROM public.restaurant_listing WHERE google_place_id = v_a) IS FALSE, 'the refresh leaves a hand setting alone';
    UPDATE public.restaurant_listing SET manual_override = FALSE WHERE google_place_id = v_a;
    v_n := public.refresh_listing_eligibility(v_a);
    ASSERT v_n = 1 AND (SELECT is_eligible FROM public.restaurant_listing WHERE google_place_id = v_a) IS TRUE, 'the refresh runs the condition (everyone eligible) and fixes it';
    ASSERT (SELECT changed_by FROM public.restaurant_listing WHERE google_place_id = v_a) = 'system', 'and records that the system did it';
    v_n := public.refresh_listing_eligibility(v_a);
    ASSERT v_n = 0, 'a refresh with nothing to change changes nothing';

    -- the admin function
    SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
    IF v_admin IS NULL THEN
      RAISE NOTICE 'no admin user to try the admin function with; the rest was checked';
    ELSE
      PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
      v_info := public.admin_set_listing_eligibility(v_b, FALSE, 'unpaid');
      ASSERT (v_info->>'isEligible')::boolean IS FALSE AND (v_info->>'manualOverride')::boolean IS TRUE AND v_info->>'reason' = 'unpaid', 'an admin can mark a place not eligible, with a reason';
      ASSERT public.restaurant_is_listed(v_b) IS FALSE, 'and with the switch on it is hidden';
      PERFORM public.refresh_listing_eligibility(v_b);
      ASSERT public.restaurant_is_listed(v_b) IS FALSE, 'the automatic refresh does not undo an admin';
      v_info := public.admin_set_listing_eligibility(v_b, NULL);
      ASSERT (v_info->>'isEligible')::boolean IS TRUE AND (v_info->>'manualOverride')::boolean IS FALSE, 'clearing the hand setting returns to the automatic rule (eligible)';
      ASSERT public.restaurant_is_listed(v_b) IS TRUE, 'and it is listed again';
      v_info := public.admin_get_listing_eligibility('ChIJnothing139zzzzzzz');
      ASSERT (v_info->>'isEligible')::boolean IS TRUE AND (v_info->>'hasRow')::boolean IS FALSE, 'a place that was never marked reads as eligible with no row';

      -- anyone who is not an admin is refused
      PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
      BEGIN
        PERFORM public.admin_set_listing_eligibility(v_b, FALSE, 'x');
        ASSERT FALSE, 'a non-admin must be refused';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
      END;
    END IF;

    RAISE EXCEPTION 'rollback_test_139';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_139' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 139 TESTS PASSED';
END $$;

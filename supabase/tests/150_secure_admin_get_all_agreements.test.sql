-- Test for migration 150: admin_get_all_agreements() now requires an admin (it did not before),
-- and returns email. Everything is tried inside a transaction that is rolled back. Needs
-- migrations 005 and 150. Success: no error.
DO $$
DECLARE
  v_admin  UUID := gen_random_uuid();
  v_other  UUID := gen_random_uuid();
  v_rows   JSONB;
BEGIN
  ASSERT has_function_privilege('authenticated', 'public.admin_get_all_agreements()', 'EXECUTE'),
    'a signed-in user can call it (the gate is inside the function, not the grant)';

  BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
      (v_admin, 'agreements150-admin@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_other, 'agreements150-other@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');

    -- record_user_agreement reads auth.uid(), so sign in as each user before recording for them
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    PERFORM public.record_user_agreement('privacy_policy', '1.0');
    PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
    PERFORM public.record_user_agreement('food_disclaimer', '1.0');

    -- ── a non-admin is refused ──
    BEGIN
      PERFORM public.admin_get_all_agreements();
      ASSERT FALSE, 'a non-admin must be refused';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
    END;

    -- ── an admin sees every row, with email joined in ──
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    SELECT jsonb_agg(jsonb_build_object('email', email, 'agreement_type', agreement_type))
      INTO v_rows
      FROM public.admin_get_all_agreements()
      WHERE user_id IN (v_admin, v_other);
    ASSERT jsonb_array_length(v_rows) = 2, 'both agreements are visible to an admin, got ' || jsonb_array_length(v_rows);
    ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r->>'email' = 'agreements150-other@example.com' AND r->>'agreement_type' = 'food_disclaimer'),
      'the email is joined in correctly for the row it belongs to';

    RAISE EXCEPTION 'rollback_test_150';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_150' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 150 TESTS PASSED';
END $$;

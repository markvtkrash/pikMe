-- Test for migration 167: the owner sets the timezone and prep time. Run the WHOLE file in one go; the rules are tried inside a
-- sub-block that is rolled back. Needs migrations 165 and 007. Success: no error, and "ALL 167 TESTS PASSED".

-- Runs one statement that must FAIL with a message matching the pattern; any other outcome stops the test.
CREATE OR REPLACE FUNCTION pg_temp.expect_error(q TEXT, pat TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE q;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE pat THEN
      RAISE EXCEPTION 'wrong error for [%]: got [%], wanted [%]', q, SQLERRM, pat;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected an error but none came: %', q;
END;
$$;

DO $$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-0000000167a1';
  v_other UUID := '00000000-0000-0000-0000-0000000167a2';
  v_rest  UUID;
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.owner_update_ordering_settings(uuid,integer,text)', 'EXECUTE'), 'anon cannot run it';
  ASSERT has_function_privilege('authenticated', 'public.owner_update_ordering_settings(uuid,integer,text)', 'EXECUTE'), 'owners can run it';

  BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
      (v_owner, 'settings-167a1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_other, 'settings-167a2@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.restaurant_owners (id, business_name, email, is_active) VALUES
      (v_owner, 'Settings Test A', 'settings-167a1@example.com', TRUE),
      (v_other, 'Settings Test B', 'settings-167a2@example.com', TRUE);
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status)
    VALUES (v_owner, 'ChIJset167aaaaaaaaaa', 'Settings Test Diner 167', '1 Main St', 'approved') RETURNING id INTO v_rest;

    ASSERT (SELECT timezone FROM public.restaurants WHERE id = v_rest) IS NULL, 'no timezone to start with';

    -- who may
    PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_update_ordering_settings(%L, 30, 'America/Chicago')$q$, v_rest), '%Not authorized%');
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
    PERFORM pg_temp.expect_error($q$SELECT public.owner_update_ordering_settings('00000000-0000-0000-0000-000000000000', 30, NULL)$q$, '%Not authorized%');

    -- the rules
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_update_ordering_settings(%L, 4, NULL)$q$, v_rest), '%between 5 and 240%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_update_ordering_settings(%L, 241, NULL)$q$, v_rest), '%between 5 and 240%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_update_ordering_settings(%L, NULL, 'Central')$q$, v_rest), '%not recognised%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_update_ordering_settings(%L, NULL, 'Not/AZone')$q$, v_rest), '%not recognised%');
    PERFORM pg_temp.expect_error(format($q$SELECT public.owner_update_ordering_settings(%L, NULL, '   ')$q$, v_rest), '%not recognised%');
    ASSERT (SELECT timezone FROM public.restaurants WHERE id = v_rest) IS NULL AND (SELECT ordering_prep_minutes FROM public.restaurants WHERE id = v_rest) = 20,
      'a refused call changes nothing';

    -- a timezone alone (the prep time is left as it was)
    PERFORM public.owner_update_ordering_settings(v_rest, NULL, '  America/Chicago  ');
    ASSERT (SELECT timezone FROM public.restaurants WHERE id = v_rest) = 'America/Chicago', 'the timezone is saved, trimmed';
    ASSERT (SELECT ordering_prep_minutes FROM public.restaurants WHERE id = v_rest) = 20, 'the prep time is untouched';

    -- a prep time alone (the timezone is left as it was)
    PERFORM public.owner_update_ordering_settings(v_rest, 45);
    ASSERT (SELECT ordering_prep_minutes FROM public.restaurants WHERE id = v_rest) = 45, 'the prep time is saved';
    ASSERT (SELECT timezone FROM public.restaurants WHERE id = v_rest) = 'America/Chicago', 'the timezone is untouched';

    -- both at once, and the edges
    PERFORM public.owner_update_ordering_settings(v_rest, 5, 'America/New_York');
    ASSERT (SELECT ordering_prep_minutes FROM public.restaurants WHERE id = v_rest) = 5 AND (SELECT timezone FROM public.restaurants WHERE id = v_rest) = 'America/New_York', 'both saved; 5 is allowed';
    PERFORM public.owner_update_ordering_settings(v_rest, 240, NULL);
    ASSERT (SELECT ordering_prep_minutes FROM public.restaurants WHERE id = v_rest) = 240, '240 is allowed';

    -- nothing at all changes nothing
    PERFORM public.owner_update_ordering_settings(v_rest);
    ASSERT (SELECT ordering_prep_minutes FROM public.restaurants WHERE id = v_rest) = 240 AND (SELECT timezone FROM public.restaurants WHERE id = v_rest) = 'America/New_York', 'no arguments, no change';

    RAISE EXCEPTION 'rollback_test_167';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_167' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 167 TESTS PASSED';
END $$;

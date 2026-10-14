-- Test for migration 142: region launch control. Everything is tried inside a transaction that is rolled back. Needs migrations 136 and 142.
-- Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_user  UUID;
  v_s     JSONB;
  v_n     INTEGER;
  v_rows  RECORD;
BEGIN
  -- the seed: 50 states and DC, Kansas live, the rest off
  ASSERT (SELECT COUNT(*) FROM public.launch_regions) >= 51, 'every state and DC is listed';
  ASSERT EXISTS (SELECT 1 FROM public.launch_regions WHERE state_code = 'DC'), 'DC is listed';

  -- nothing is exposed that should not be
  ASSERT NOT has_table_privilege('authenticated', 'public.launch_regions', 'SELECT'), 'a customer cannot read the regions table directly';
  ASSERT NOT has_table_privilege('authenticated', 'public.region_waitlist', 'SELECT'), 'a customer cannot read the waitlist table';
  ASSERT NOT has_table_privilege('authenticated', 'public.region_cells', 'SELECT'), 'a customer cannot read the location cache';
  ASSERT has_table_privilege('service_role', 'public.region_cells', 'SELECT'), 'the service role can read the location cache';
  ASSERT NOT has_function_privilege('authenticated', 'public.record_region_cell(text, text, text)', 'EXECUTE'), 'a customer cannot write the location cache';
  ASSERT has_function_privilege('service_role', 'public.record_region_cell(text, text, text)', 'EXECUTE'), 'the service role can';
  ASSERT has_function_privilege('service_role', 'public.region_status(text, text)', 'EXECUTE'), 'the edge function can ask a state''s status';
  ASSERT NOT has_function_privilege('anon', 'public.admin_set_region(text, text, timestamptz, text)', 'EXECUTE'), 'anon cannot change a region';

  ASSERT (SELECT value FROM public.app_config WHERE key = 'enforceRegionGating') IS NOT NULL, 'the switch exists';

  BEGIN
    UPDATE public.app_config SET value = 'false' WHERE key = 'enforceRegionGating';
    ASSERT public.region_gate_enforced() IS FALSE, 'the switch reads as off';

    -- a place in an off state is fine while the switch is off
    UPDATE public.launch_regions SET status = 'off', go_live_at = NULL WHERE state_code = 'TX';
    INSERT INTO public.cached_restaurants (place_id, name, address) VALUES ('ChIJregion142txxxxxxxx', 'Texas Cafe142', '1 Main St, Austin, TX 78701, USA');
    ASSERT public.place_region_allowed('ChIJregion142txxxxxxxx') IS TRUE, 'with the switch off a place is allowed whatever its state';

    -- the switch on
    UPDATE public.app_config SET value = 'true' WHERE key = 'enforceRegionGating';
    ASSERT public.region_gate_enforced() IS TRUE, 'the switch reads as on';
    ASSERT public.place_region_allowed('ChIJregion142txxxxxxxx') IS FALSE, 'a place in an off state is not allowed';
    ASSERT public.place_region_allowed('ChIJnoplace142zzzzzzzz') IS TRUE, 'a place we know nothing about is allowed';

    -- the status of a state
    v_s := public.region_status('US', 'TX');
    ASSERT (v_s->>'allowed')::boolean IS FALSE AND v_s->>'status' = 'off' AND v_s->>'name' = 'Texas', 'an off state is not allowed';
    UPDATE public.launch_regions SET status = 'live' WHERE state_code = 'TX';
    v_s := public.region_status('us', 'tx');
    ASSERT (v_s->>'allowed')::boolean IS TRUE AND v_s->>'status' = 'live', 'a live state is allowed (case ignored)';
    ASSERT public.place_region_allowed('ChIJregion142txxxxxxxx') IS TRUE, 'and its places are allowed';

    UPDATE public.launch_regions SET status = 'scheduled', go_live_at = NOW() + INTERVAL '2 days' WHERE state_code = 'TX';
    v_s := public.region_status('US', 'TX');
    ASSERT (v_s->>'allowed')::boolean IS FALSE AND v_s->>'status' = 'scheduled' AND v_s->>'goLiveAt' IS NOT NULL, 'a scheduled state in the future is not open and shows when it opens';
    UPDATE public.launch_regions SET go_live_at = NOW() - INTERVAL '1 minute' WHERE state_code = 'TX';
    v_s := public.region_status('US', 'TX');
    ASSERT (v_s->>'allowed')::boolean IS TRUE AND v_s->>'status' = 'live', 'a scheduled state opens by itself when its time has passed';

    v_s := public.region_status('CA', 'ON');
    ASSERT (v_s->>'allowed')::boolean IS FALSE AND v_s->>'status' = 'not_us', 'outside the US is not allowed';
    v_s := public.region_status('US', 'ZZ');
    ASSERT (v_s->>'allowed')::boolean IS FALSE AND v_s->>'status' = 'unknown', 'a state we do not know is not allowed';
    v_s := public.region_status('US', NULL);
    ASSERT (v_s->>'allowed')::boolean IS FALSE, 'no state is not allowed';

    -- the location cache
    PERFORM public.record_region_cell('37.77,-122.41', 'ca', 'us');
    ASSERT EXISTS (SELECT 1 FROM public.region_cell_lookup('37.77,-122.41') WHERE state_code = 'CA' AND country_code = 'US'), 'a cached square is answered, upper-cased';
    UPDATE public.region_cells SET cached_at = NOW() - INTERVAL '31 days' WHERE cell_key = '37.77,-122.41';
    ASSERT NOT EXISTS (SELECT 1 FROM public.region_cell_lookup('37.77,-122.41')), 'an answer older than 30 days is not used';
    PERFORM public.record_region_cell('37.77,-122.41', 'CA', 'US');
    ASSERT EXISTS (SELECT 1 FROM public.region_cell_lookup('37.77,-122.41')), 'recording it again refreshes it';

    -- the waitlist and the admin page
    SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
    SELECT u.id INTO v_user FROM auth.users u WHERE u.id <> COALESCE(v_admin, '00000000-0000-0000-0000-000000000000') LIMIT 1;

    IF v_user IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
      ASSERT public.join_region_waitlist('Me@Example.com ', 'US', 'ny') IS TRUE, 'a customer can join the waitlist';
      ASSERT public.join_region_waitlist('me@example.com', 'US', 'NY') IS TRUE, 'joining twice is fine';
      ASSERT (SELECT COUNT(*) FROM public.region_waitlist WHERE email = 'me@example.com' AND state_code = 'NY') = 1, 'and is one row, with the email lower-cased';
      BEGIN
        PERFORM public.join_region_waitlist('not-an-email', 'US', 'NY');
        ASSERT FALSE, 'a bad email must be refused';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%valid email%' THEN RAISE; END IF;
      END;
      PERFORM public.leave_region_waitlist('US', 'NY');
      ASSERT NOT EXISTS (SELECT 1 FROM public.region_waitlist WHERE email = 'me@example.com' AND state_code = 'NY'), 'a customer can leave the waitlist';
      PERFORM public.join_region_waitlist('me@example.com', 'US', 'NY');
    ELSE
      RAISE NOTICE 'no user to try the waitlist with; the rest was checked';
    END IF;

    IF v_admin IS NULL THEN
      RAISE NOTICE 'no admin user to try the admin functions with; the rest was checked';
    ELSE
      PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

      SELECT * INTO v_rows FROM public.admin_list_regions() WHERE state_code = 'TX';
      ASSERT v_rows.name = 'Texas' AND v_rows.restaurant_count >= 1, 'the admin list counts a state''s restaurants';
      IF v_user IS NOT NULL THEN
        SELECT * INTO v_rows FROM public.admin_list_regions() WHERE state_code = 'NY';
        ASSERT v_rows.waitlist_count >= 1, 'and its waitlist';
        ASSERT EXISTS (SELECT 1 FROM public.admin_region_waitlist('NY') WHERE email = 'me@example.com'), 'the admin can read a waitlist';
      END IF;

      PERFORM public.admin_set_region('tx', 'live', NULL, '  first week  ');
      SELECT * INTO v_rows FROM public.admin_list_regions() WHERE state_code = 'TX';
      ASSERT v_rows.status = 'live' AND v_rows.is_open IS TRUE AND v_rows.go_live_at IS NULL AND v_rows.note = 'first week', 'an admin can open a state, with a note';
      PERFORM public.admin_set_region('TX', 'scheduled', NOW() + INTERVAL '3 days', NULL);
      SELECT * INTO v_rows FROM public.admin_list_regions() WHERE state_code = 'TX';
      ASSERT v_rows.status = 'scheduled' AND v_rows.is_open IS FALSE AND v_rows.go_live_at IS NOT NULL, 'or schedule it';
      BEGIN
        PERFORM public.admin_set_region('TX', 'scheduled', NULL, NULL);
        ASSERT FALSE, 'scheduling without a time must be refused';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%when the state opens%' THEN RAISE; END IF;
      END;
      BEGIN
        PERFORM public.admin_set_region('TX', 'maybe', NULL, NULL);
        ASSERT FALSE, 'a bad status must be refused';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%off, scheduled or live%' THEN RAISE; END IF;
      END;
      BEGIN
        PERFORM public.admin_set_region('ZZ', 'live', NULL, NULL);
        ASSERT FALSE, 'an unknown state must be refused';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%Unknown state%' THEN RAISE; END IF;
      END;

      PERFORM public.admin_set_region('TX', 'live', NULL, NULL);
      v_n := public.admin_turn_off_all_regions();
      ASSERT v_n >= 1, 'the emergency button turns every open state off';
      ASSERT NOT EXISTS (SELECT 1 FROM public.launch_regions WHERE status <> 'off'), 'and none is left on';
      ASSERT public.admin_turn_off_all_regions() = 0, 'pressing it again changes nothing';

      -- anyone who is not an admin is refused
      PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
      BEGIN
        PERFORM public.admin_set_region('TX', 'live', NULL, NULL);
        ASSERT FALSE, 'a non-admin must be refused';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
      END;
    END IF;

    RAISE EXCEPTION 'rollback_test_142';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_142' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 142 TESTS PASSED';
END $$;

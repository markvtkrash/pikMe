-- Test for migration 147: anonymous app events. Everything is tried inside a transaction that is rolled back. Needs migration 147 (and an admin user for
-- the summary part). Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_a CONSTANT TEXT := 'install-147-aaaaaaaa';
  v_b CONSTANT TEXT := 'install-147-bbbbbbbb';
  v_c CONSTANT TEXT := 'install-147-cccccccc';
  v_n INTEGER;
  v_s JSONB;
BEGIN
  -- ── nothing is exposed that should not be ──
  ASSERT NOT has_table_privilege('anon', 'public.app_events', 'SELECT'), 'anon cannot read the events';
  ASSERT NOT has_table_privilege('authenticated', 'public.app_events', 'SELECT'), 'a customer cannot read the events';
  ASSERT NOT has_table_privilege('anon', 'public.app_events', 'INSERT'), 'anon cannot write to the table directly';
  ASSERT NOT has_table_privilege('authenticated', 'public.app_events', 'INSERT'), 'a customer cannot write to the table directly';
  ASSERT has_function_privilege('anon', 'public.log_app_event(text, text, jsonb, text, text)', 'EXECUTE'), 'anyone can log an event';
  ASSERT has_function_privilege('authenticated', 'public.log_app_event(text, text, jsonb, text, text)', 'EXECUTE'), 'a signed-in customer can log an event';
  ASSERT NOT has_function_privilege('anon', 'public.admin_analytics_summary(integer)', 'EXECUTE'), 'anon cannot read the summary';
  ASSERT NOT has_function_privilege('authenticated', 'public.purge_old_app_events(integer)', 'EXECUTE'), 'a customer cannot purge';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.app_events'::regclass), 'row level security is on';
  ASSERT 'app_open' = ANY (public._analytics_events()) AND 'sign_up' = ANY (public._analytics_events()), 'the known events are listed';

  BEGIN
    -- ── a good event is stored, with only what we expect ──
    PERFORM public.log_app_event(v_a, 'app_open', '{"first": true}'::jsonb, 'ios', '1.2.3');
    SELECT COUNT(*) INTO v_n FROM public.app_events WHERE install_id = v_a;
    ASSERT v_n = 1, 'a good event is stored, got ' || v_n;
    ASSERT (SELECT platform FROM public.app_events WHERE install_id = v_a) = 'ios', 'the platform is kept';
    ASSERT (SELECT app_version FROM public.app_events WHERE install_id = v_a) = '1.2.3', 'the version is kept';
    ASSERT (SELECT props->>'first' FROM public.app_events WHERE install_id = v_a) = 'true', 'the details are kept';

    -- ── bad calls are ignored, not errors ──
    PERFORM public.log_app_event(NULL, 'app_open');
    PERFORM public.log_app_event('short', 'app_open');                       -- install ID too short
    PERFORM public.log_app_event('has spaces and ! chars here', 'app_open'); -- install ID with odd characters
    PERFORM public.log_app_event(repeat('x', 65), 'app_open');               -- install ID too long
    PERFORM public.log_app_event(v_b, 'not_an_event');                       -- unknown event name
    PERFORM public.log_app_event(v_b, NULL);
    SELECT COUNT(*) INTO v_n FROM public.app_events WHERE install_id IN (v_b, 'short', repeat('x', 65)) OR install_id LIKE 'has spaces%';
    ASSERT v_n = 0, 'bad calls store nothing, got ' || v_n;

    -- ── the extra details are capped, and the rest is cleaned ──
    PERFORM public.log_app_event(v_b, 'search', jsonb_build_object('big', repeat('x', 600)));
    ASSERT (SELECT props FROM public.app_events WHERE install_id = v_b) = '{}'::jsonb, 'too-large details are dropped, the event is kept';
    PERFORM public.log_app_event(v_b, 'menu_view', '[1,2]'::jsonb);
    ASSERT (SELECT props FROM public.app_events WHERE install_id = v_b AND event = 'menu_view') = '{}'::jsonb, 'details that are not an object are dropped';
    PERFORM public.log_app_event(v_b, 'save', '{}'::jsonb, 'blackberry', repeat('9', 21));
    ASSERT (SELECT platform FROM public.app_events WHERE install_id = v_b AND event = 'save') IS NULL, 'an unknown platform is not stored';
    ASSERT (SELECT app_version FROM public.app_events WHERE install_id = v_b AND event = 'save') IS NULL, 'a too-long version is not stored';

    -- ── one install cannot flood the table ──
    INSERT INTO public.app_events (install_id, event) SELECT v_c, 'app_open' FROM generate_series(1, 300);
    PERFORM public.log_app_event(v_c, 'app_open');
    SELECT COUNT(*) INTO v_n FROM public.app_events WHERE install_id = v_c;
    ASSERT v_n = 300, 'past 300 an hour nothing more is stored, got ' || v_n;
    DELETE FROM public.app_events WHERE install_id = v_c;

    -- ── cleanup of old rows ──
    INSERT INTO public.app_events (install_id, event, created_at) VALUES (v_c, 'app_open', now() - interval '400 days'), (v_c, 'app_open', now() - interval '10 days');
    v_n := public.purge_old_app_events(180);
    ASSERT v_n >= 1, 'an old row is deleted';
    ASSERT NOT EXISTS (SELECT 1 FROM public.app_events WHERE install_id = v_c AND created_at < now() - interval '180 days'), 'no row older than 180 days is left';
    ASSERT EXISTS (SELECT 1 FROM public.app_events WHERE install_id = v_c), 'a recent row is kept';
    PERFORM public.purge_old_app_events(1);
    ASSERT EXISTS (SELECT 1 FROM public.app_events WHERE install_id = v_c AND created_at > now() - interval '11 days'), 'the cleanup never goes below 30 days';
    DELETE FROM public.app_events WHERE install_id = v_c;

    -- ── the admin summary ──
    SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
    IF v_admin IS NULL THEN
      RAISE NOTICE 'no admin user to try the summary with; that part was not checked';
    ELSE
      PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

      -- start from a clean table inside this rolled-back transaction, so the numbers can be exact
      DELETE FROM public.app_events;
      -- install A: first seen 20 days ago, comes back 10 days ago (a week or more later) and today
      INSERT INTO public.app_events (install_id, event, created_at) VALUES
        (v_a, 'app_open', now() - interval '20 days'),
        (v_a, 'search', now() - interval '20 days'),
        (v_a, 'app_open', now() - interval '10 days'),
        (v_a, 'app_open', now());
      -- install B: first seen 15 days ago and never again (in the cohort, did not return)
      INSERT INTO public.app_events (install_id, event, created_at) VALUES
        (v_b, 'app_open', now() - interval '15 days'),
        (v_b, 'restaurant_view', now() - interval '15 days'),
        (v_b, 'menu_view', now() - interval '15 days'),
        (v_b, 'save', now() - interval '15 days');
      -- install C: first seen 2 days ago (too new for the week-later cohort)
      INSERT INTO public.app_events (install_id, event, created_at) VALUES
        (v_c, 'app_open', now() - interval '2 days'),
        (v_c, 'sign_up', now() - interval '2 days');
      -- an old event outside a 30-day window, from install A's earlier life: counted as first seen long ago
      INSERT INTO public.app_events (install_id, event, created_at) VALUES ('install-147-dddddddd', 'app_open', now() - interval '100 days');

      v_s := public.admin_analytics_summary(30);
      ASSERT (v_s->>'days')::INTEGER = 30, 'the period is reported';
      ASSERT (v_s->>'installs')::INTEGER = 3, 'three installs were seen in the period, got ' || (v_s->>'installs');
      ASSERT (v_s->>'new_installs')::INTEGER = 3, 'all three were first seen in the period, got ' || (v_s->>'new_installs');
      ASSERT jsonb_array_length(v_s->'events') = cardinality(public._analytics_events()), 'every known event has a row, even with no events';
      ASSERT (SELECT (e->>'events')::INTEGER FROM jsonb_array_elements(v_s->'events') e WHERE e->>'event' = 'app_open') = 5, 'five app_open events in the period';
      ASSERT (SELECT (e->>'installs')::INTEGER FROM jsonb_array_elements(v_s->'events') e WHERE e->>'event' = 'app_open') = 3, 'from three installs';
      ASSERT (SELECT (e->>'installs')::INTEGER FROM jsonb_array_elements(v_s->'events') e WHERE e->>'event' = 'save') = 1, 'one install saved';
      ASSERT (SELECT (e->>'events')::INTEGER FROM jsonb_array_elements(v_s->'events') e WHERE e->>'event' = 'share') = 0, 'an event nobody sent is zero';
      ASSERT jsonb_array_length(v_s->'daily') = 30, 'one row for every day of the period, got ' || jsonb_array_length(v_s->'daily');
      ASSERT (v_s->'retention'->>'cohort')::INTEGER = 2, 'two installs are old enough for the week-later count, got ' || (v_s->'retention'->>'cohort');
      ASSERT (v_s->'retention'->>'returned')::INTEGER = 1, 'one of them came back a week or more later, got ' || (v_s->'retention'->>'returned');

      -- the period is limited to 1..365 days
      ASSERT (public.admin_analytics_summary(0)->>'days')::INTEGER = 1, 'zero days becomes one';
      ASSERT (public.admin_analytics_summary(9999)->>'days')::INTEGER = 365, 'too many days becomes 365';
      -- a 100+ day window includes the old install
      ASSERT (public.admin_analytics_summary(150)->>'installs')::INTEGER = 4, 'a longer period includes the older install';

      -- a non-admin is refused
      PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
      BEGIN
        PERFORM public.admin_analytics_summary(30);
        ASSERT FALSE, 'a non-admin must be refused';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
      END;
    END IF;

    RAISE EXCEPTION 'rollback_test_147';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_147' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 147 TESTS PASSED';
END $$;

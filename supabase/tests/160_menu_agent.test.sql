-- Test for migration 160: the menu agent (settings, tables, eligibility, claim, steps, finish, approval).
-- Nine self-contained blocks. Each one works inside a sub-block that is rolled back, so nothing is left behind
-- (settings it changes and any agent rows it clears are put back by the rollback).
-- The blocks that need an admin use the first existing admin and fall back to wiring checks when there is none.
-- Success: no error, and "ALL 160 TESTS PASSED" at the end.

-- ── Block 1: settings, table security, function access ──────────────────────
DO $$
DECLARE
  k   TEXT;
  v   TEXT;
  sig TEXT;
BEGIN
  FOREACH k IN ARRAY ARRAY['menuAgentEnabled', 'menuAgentAiProvider', 'menuAgentModel', 'menuAgentVisionModel',
    'menuAgentMaxSteps', 'menuAgentDailyTokenCap', 'menuAgentDailyJobCap', 'menuAgentInputPricePerMTok',
    'menuAgentOutputPricePerMTok'] LOOP
    ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = k), k || ' row exists';
    ASSERT COALESCE((SELECT description FROM public.app_config WHERE key = k), '') <> '', k || ' is described';
  END LOOP;

  -- values (a fresh install holds: false / quicksilver / blank / blank / 10 / blank ...; an admin may have changed them since)
  SELECT value INTO v FROM public.app_config WHERE key = 'menuAgentEnabled';
  ASSERT v IN ('true', 'false'), 'menuAgentEnabled is true or false';
  SELECT value INTO v FROM public.app_config WHERE key = 'menuAgentAiProvider';
  ASSERT v IN ('quicksilver', 'claude', ''), 'menuAgentAiProvider is quicksilver, claude, or blank (follow the app-wide provider)';
  SELECT value INTO v FROM public.app_config WHERE key = 'menuAgentMaxSteps';
  ASSERT v ~ '^[0-9]{1,2}$' AND v::INTEGER BETWEEN 1 AND 50, 'menuAgentMaxSteps is a whole number from 1 to 50';
  FOREACH k IN ARRAY ARRAY['menuAgentModel', 'menuAgentVisionModel'] LOOP
    SELECT value INTO v FROM public.app_config WHERE key = k;
    ASSERT v = '' OR v ~ '^[A-Za-z0-9._:/-]+$', k || ' is blank or a plain model name';
  END LOOP;
  FOREACH k IN ARRAY ARRAY['menuAgentDailyTokenCap', 'menuAgentDailyJobCap'] LOOP
    SELECT value INTO v FROM public.app_config WHERE key = k;
    ASSERT v = '' OR v ~ '^[0-9]{1,12}$', k || ' is blank (unlimited) or a whole number';
  END LOOP;
  FOREACH k IN ARRAY ARRAY['menuAgentInputPricePerMTok', 'menuAgentOutputPricePerMTok'] LOOP
    SELECT value INTO v FROM public.app_config WHERE key = k;
    ASSERT v = '' OR v ~ '^[0-9]+(\.[0-9]+)?$', k || ' is blank (no estimate) or a plain number';
  END LOOP;

  -- the provider setting says it defaults to quicksilver and names its optional env var
  ASSERT (SELECT description FROM public.app_config WHERE key = 'menuAgentAiProvider') ~* 'defaults to quicksilver',
    'the provider description says it defaults to quicksilver';
  ASSERT (SELECT env_var_name FROM public.app_config WHERE key = 'menuAgentAiProvider') = 'Edge function: MENU_AGENT_AI_PROVIDER (optional)',
    'the provider env var name is documented';

  -- tables: row level security on, no customer access, service role has access
  FOREACH k IN ARRAY ARRAY['menu_agent_jobs', 'menu_agent_steps', 'menu_agent_proposals'] LOOP
    ASSERT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || k)::regclass), k || ' has row level security on';
    ASSERT NOT has_table_privilege('anon', 'public.' || k, 'SELECT'), 'anon cannot read ' || k;
    ASSERT NOT has_table_privilege('authenticated', 'public.' || k, 'SELECT'), 'customers cannot read ' || k;
    ASSERT NOT has_table_privilege('authenticated', 'public.' || k, 'INSERT'), 'customers cannot write ' || k;
    ASSERT has_table_privilege('service_role', 'public.' || k, 'SELECT, INSERT, UPDATE, DELETE'), 'service role can use ' || k;
  END LOOP;

  -- functions: server-only ones
  FOREACH sig IN ARRAY ARRAY[
    'public.menu_agent_enabled()',
    'public.request_menu_agent_job(text,text,text)',
    'public.claim_menu_agent_job()',
    'public.record_menu_agent_step(bigint,text,text,text,integer,integer,text)',
    'public.finish_menu_agent_job(bigint,text,text,jsonb)',
    'public.merge_approved_menu_agent_proposals(text,text,jsonb)'] LOOP
    ASSERT NOT has_function_privilege('anon', sig, 'EXECUTE'), 'anon cannot run ' || sig;
    ASSERT NOT has_function_privilege('authenticated', sig, 'EXECUTE'), 'customers cannot run ' || sig;
    ASSERT has_function_privilege('service_role', sig, 'EXECUTE'), 'service role can run ' || sig;
  END LOOP;

  -- functions: internal helpers
  FOREACH sig IN ARRAY ARRAY['public._menu_agent_limit(text)', 'public._menu_agent_cap_reached()'] LOOP
    ASSERT NOT has_function_privilege('anon', sig, 'EXECUTE'), 'anon cannot run ' || sig;
    ASSERT NOT has_function_privilege('authenticated', sig, 'EXECUTE'), 'customers cannot run ' || sig;
  END LOOP;

  -- functions: admin ones (signed-in users may call them; the admin check is inside, tested in block 8)
  FOREACH sig IN ARRAY ARRAY['public.admin_list_menu_agent_proposals(text,integer,integer)',
                             'public.admin_decide_menu_agent_proposals(bigint[],boolean)'] LOOP
    ASSERT NOT has_function_privilege('anon', sig, 'EXECUTE'), 'anon cannot run ' || sig;
    ASSERT has_function_privilege('authenticated', sig, 'EXECUTE'), 'signed-in users can reach ' || sig;
  END LOOP;

  RAISE NOTICE 'PASS: block 1 (settings, security, access)';
END $$;

-- ── Block 2: the switch, the limit reader and the daily caps ────────────────
DO $$
DECLARE
  v_job BIGINT;
BEGIN
  BEGIN
    -- menu_agent_enabled: only the word true (any case, spaces ignored) turns it on
    UPDATE public.app_config SET value = 'true' WHERE key = 'menuAgentEnabled';
    ASSERT public.menu_agent_enabled() IS TRUE, 'true turns the agent on';
    UPDATE public.app_config SET value = '  TRUE ' WHERE key = 'menuAgentEnabled';
    ASSERT public.menu_agent_enabled() IS TRUE, 'TRUE with spaces turns the agent on';
    UPDATE public.app_config SET value = 'false' WHERE key = 'menuAgentEnabled';
    ASSERT public.menu_agent_enabled() IS FALSE, 'false keeps it off';
    UPDATE public.app_config SET value = 'yes' WHERE key = 'menuAgentEnabled';
    ASSERT public.menu_agent_enabled() IS FALSE, 'anything other than true keeps it off';
    UPDATE public.app_config SET value = '' WHERE key = 'menuAgentEnabled';
    ASSERT public.menu_agent_enabled() IS FALSE, 'blank keeps it off';
    DELETE FROM public.app_config WHERE key = 'menuAgentEnabled';
    ASSERT public.menu_agent_enabled() IS FALSE, 'a missing setting keeps it off';

    -- _menu_agent_limit: a whole number, or NULL (no limit) for blank, text, decimals, negatives, too long, missing
    UPDATE public.app_config SET value = '500' WHERE key = 'menuAgentDailyTokenCap';
    ASSERT public._menu_agent_limit('menuAgentDailyTokenCap') = 500, 'a whole number is read';
    UPDATE public.app_config SET value = '' WHERE key = 'menuAgentDailyTokenCap';
    ASSERT public._menu_agent_limit('menuAgentDailyTokenCap') IS NULL, 'blank means no limit';
    UPDATE public.app_config SET value = 'abc' WHERE key = 'menuAgentDailyTokenCap';
    ASSERT public._menu_agent_limit('menuAgentDailyTokenCap') IS NULL, 'text means no limit';
    UPDATE public.app_config SET value = '12.5' WHERE key = 'menuAgentDailyTokenCap';
    ASSERT public._menu_agent_limit('menuAgentDailyTokenCap') IS NULL, 'a decimal means no limit';
    UPDATE public.app_config SET value = '-5' WHERE key = 'menuAgentDailyTokenCap';
    ASSERT public._menu_agent_limit('menuAgentDailyTokenCap') IS NULL, 'a negative number means no limit';
    UPDATE public.app_config SET value = '1234567890123' WHERE key = 'menuAgentDailyTokenCap';
    ASSERT public._menu_agent_limit('menuAgentDailyTokenCap') IS NULL, 'more than 12 digits means no limit';
    ASSERT public._menu_agent_limit('menuAgentNoSuchKey') IS NULL, 'a missing setting means no limit';

    -- _menu_agent_cap_reached: start from a clean slate (rolled back at the end)
    DELETE FROM public.menu_agent_jobs;
    UPDATE public.app_config SET value = '' WHERE key IN ('menuAgentDailyTokenCap', 'menuAgentDailyJobCap');
    ASSERT public._menu_agent_cap_reached() IS FALSE, 'no caps set: never reached';

    -- token cap: input + output of steps in the last 24 hours
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, claimed_at)
    VALUES ('test160placeA01', 'Test A', 'https://a.example.com', 'done', 2, NOW())
    RETURNING id INTO v_job;
    UPDATE public.app_config SET value = '100' WHERE key = 'menuAgentDailyTokenCap';
    ASSERT public._menu_agent_cap_reached() IS FALSE, 'no steps yet: token cap not reached';
    INSERT INTO public.menu_agent_steps (job_id, step_no, action, input_tokens, output_tokens) VALUES (v_job, 1, 'read_page', 60, 39);
    ASSERT public._menu_agent_cap_reached() IS FALSE, '99 of 100 tokens: not reached';
    INSERT INTO public.menu_agent_steps (job_id, step_no, action, input_tokens, output_tokens) VALUES (v_job, 2, 'read_page', 0, 1);
    ASSERT public._menu_agent_cap_reached() IS TRUE, '100 of 100 tokens: reached';
    UPDATE public.menu_agent_steps SET created_at = NOW() - INTERVAL '25 hours';
    ASSERT public._menu_agent_cap_reached() IS FALSE, 'steps older than 24 hours are not counted';
    UPDATE public.app_config SET value = '' WHERE key = 'menuAgentDailyTokenCap';

    -- job cap: jobs first claimed (attempts = 1) in the last 24 hours; a retry (attempts 2) is not counted again
    DELETE FROM public.menu_agent_jobs;
    UPDATE public.app_config SET value = '2' WHERE key = 'menuAgentDailyJobCap';
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, claimed_at)
    VALUES ('test160placeB01', 'Test B', 'https://b.example.com', 'done', 1, NOW());
    ASSERT public._menu_agent_cap_reached() IS FALSE, '1 of 2 jobs: not reached';
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, claimed_at)
    VALUES ('test160placeB02', 'Test B2', 'https://b2.example.com', 'done', 3, NOW());
    ASSERT public._menu_agent_cap_reached() IS FALSE, 'a retried job does not count a second time';
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, claimed_at)
    VALUES ('test160placeB03', 'Test B3', 'https://b3.example.com', 'done', 1, NOW() - INTERVAL '25 hours');
    ASSERT public._menu_agent_cap_reached() IS FALSE, 'a job claimed over 24 hours ago does not count';
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, claimed_at)
    VALUES ('test160placeB04', 'Test B4', 'https://b4.example.com', 'done', 1, NOW());
    ASSERT public._menu_agent_cap_reached() IS TRUE, '2 of 2 jobs: reached';

    RAISE EXCEPTION 'rollback_test_160';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_160' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 2 (switch, limit reader, daily caps)';
END $$;


-- ── Block 3: request_menu_agent_job (who is eligible) ───────────────────────
DO $$
BEGIN
  BEGIN
    DELETE FROM public.menu_agent_jobs;
    INSERT INTO public.franchise_chains (name, category) VALUES ('Zztest160 Burger Chain', 'Burgers');
    UPDATE public.app_config SET value = 'false' WHERE key = 'menuAgentEnabled';

    -- switched off: nothing is queued, whatever the input
    ASSERT public.request_menu_agent_job('test160place0001', 'Test Cafe', 'https://cafe.example.com/menu') = 'disabled',
      'disabled while the master switch is off';
    ASSERT NOT EXISTS (SELECT 1 FROM public.menu_agent_jobs), 'nothing queued while disabled';

    UPDATE public.app_config SET value = 'true' WHERE key = 'menuAgentEnabled';

    -- bad input
    ASSERT public.request_menu_agent_job(NULL, 'Test Cafe', 'https://cafe.example.com') = 'bad_input', 'no place id';
    ASSERT public.request_menu_agent_job('short', 'Test Cafe', 'https://cafe.example.com') = 'bad_input', 'place id too short';
    ASSERT public.request_menu_agent_job('bad id with spaces', 'Test Cafe', 'https://cafe.example.com') = 'bad_input', 'place id with spaces';
    ASSERT public.request_menu_agent_job('test160place0001', NULL, 'https://cafe.example.com') = 'bad_input', 'no name';
    ASSERT public.request_menu_agent_job('test160place0001', '   ', 'https://cafe.example.com') = 'bad_input', 'blank name';
    ASSERT public.request_menu_agent_job('test160place0001', 'Test Cafe', NULL) = 'bad_input', 'no link';
    ASSERT public.request_menu_agent_job('test160place0001', 'Test Cafe', 'not a link') = 'bad_input', 'link is not a web address';
    ASSERT public.request_menu_agent_job('test160place0001', 'Test Cafe', 'ftp://cafe.example.com/menu') = 'bad_input', 'only http and https links';
    ASSERT public.request_menu_agent_job('test160place0001', 'Test Cafe', 'https://a b.example.com') = 'bad_input', 'link with a space';
    ASSERT public.request_menu_agent_job('test160place0001', 'Test Cafe', 'https://' || repeat('a', 2000)) = 'bad_input', 'link over 2000 characters';
    ASSERT NOT EXISTS (SELECT 1 FROM public.menu_agent_jobs), 'nothing queued for bad input';

    -- a franchise uses the shared chain menu
    ASSERT public.request_menu_agent_job('test160place0002', 'Zztest160 Burger Chain', 'https://chain.example.com/menu') = 'franchise',
      'a franchise is refused';
    ASSERT NOT EXISTS (SELECT 1 FROM public.menu_agent_jobs), 'nothing queued for a franchise';

    -- a restaurant that already has a verified item
    INSERT INTO public.menu_items (item_id, restaurant_name, name, place_id, is_verified)
    VALUES ('test160_item_v1', 'Has Menu Cafe', 'Verified Dish', 'test160place0003', TRUE);
    ASSERT public.request_menu_agent_job('test160place0003', 'Has Menu Cafe', 'https://hasmenu.example.com') = 'has_menu',
      'a restaurant with a verified item is refused';

    -- only unverified items (an AI guess): still eligible
    INSERT INTO public.menu_items (item_id, restaurant_name, name, place_id, is_verified)
    VALUES ('test160_item_g1', 'Guess Cafe', 'Guessed Dish', 'test160place0004', FALSE);
    ASSERT public.request_menu_agent_job('test160place0004', 'Guess Cafe', 'https://guess.example.com') = 'queued',
      'a restaurant with only unverified items is queued';

    -- a normal independent restaurant: queued, once
    ASSERT public.request_menu_agent_job('test160place0001', '  Test Cafe  ', ' https://cafe.example.com/menu ') = 'queued', 'queued';
    ASSERT (SELECT restaurant_name FROM public.menu_agent_jobs WHERE place_id = 'test160place0001') = 'Test Cafe', 'the name is trimmed';
    ASSERT (SELECT start_url FROM public.menu_agent_jobs WHERE place_id = 'test160place0001') = 'https://cafe.example.com/menu', 'the link is trimmed';
    ASSERT (SELECT status FROM public.menu_agent_jobs WHERE place_id = 'test160place0001') = 'pending', 'a new job is pending';
    ASSERT public.request_menu_agent_job('test160place0001', 'Test Cafe', 'https://cafe.example.com/menu') = 'already_open', 'a second request is ignored';
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_jobs WHERE place_id = 'test160place0001') = 1, 'still one job';

    -- a running job also blocks a new one
    UPDATE public.menu_agent_jobs SET status = 'running' WHERE place_id = 'test160place0001';
    ASSERT public.request_menu_agent_job('test160place0001', 'Test Cafe', 'https://cafe.example.com/menu') = 'already_open', 'a running job blocks a new request';

    -- a finished job does not: the restaurant can be tried again
    UPDATE public.menu_agent_jobs SET status = 'no_items' WHERE place_id = 'test160place0001';
    ASSERT public.request_menu_agent_job('test160place0001', 'Test Cafe', 'https://cafe.example.com/menu2') = 'queued', 'queued again after a finished job';
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_jobs WHERE place_id = 'test160place0001') = 2, 'the history is kept';

    RAISE EXCEPTION 'rollback_test_160';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_160' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 3 (eligibility and request)';
END $$;


-- ── Block 4: claim_menu_agent_job (switch, caps, order, step limit) ─────────
DO $$
DECLARE
  v_claim RECORD;
  v_n     INTEGER;
BEGIN
  BEGIN
    DELETE FROM public.menu_agent_jobs;
    UPDATE public.app_config SET value = 'true' WHERE key = 'menuAgentEnabled';
    UPDATE public.app_config SET value = '' WHERE key IN ('menuAgentDailyTokenCap', 'menuAgentDailyJobCap');
    UPDATE public.app_config SET value = '7' WHERE key = 'menuAgentMaxSteps';

    SELECT COUNT(*) INTO v_n FROM public.claim_menu_agent_job();
    ASSERT v_n = 0, 'nothing waiting: nothing handed out';

    PERFORM public.request_menu_agent_job('test160place0011', 'Second Cafe', 'https://second.example.com');
    UPDATE public.menu_agent_jobs SET requested_at = NOW() - INTERVAL '1 hour' WHERE place_id = 'test160place0011';
    PERFORM public.request_menu_agent_job('test160place0010', 'First Cafe', 'https://first.example.com');
    UPDATE public.menu_agent_jobs SET requested_at = NOW() - INTERVAL '2 hours' WHERE place_id = 'test160place0010';

    -- switched off: nothing handed out, and the jobs are untouched
    UPDATE public.app_config SET value = 'false' WHERE key = 'menuAgentEnabled';
    SELECT COUNT(*) INTO v_n FROM public.claim_menu_agent_job();
    ASSERT v_n = 0, 'switched off: nothing handed out';
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_jobs WHERE status = 'pending' AND attempts = 0) = 2, 'switched off: jobs untouched';
    UPDATE public.app_config SET value = 'true' WHERE key = 'menuAgentEnabled';

    -- a daily cap that is reached: nothing handed out
    UPDATE public.app_config SET value = '1' WHERE key = 'menuAgentDailyJobCap';
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, claimed_at)
    VALUES ('test160place0019', 'Capped', 'https://capped.example.com', 'done', 1, NOW());
    SELECT COUNT(*) INTO v_n FROM public.claim_menu_agent_job();
    ASSERT v_n = 0, 'cap reached: nothing handed out';
    DELETE FROM public.menu_agent_jobs WHERE place_id = 'test160place0019';
    UPDATE public.app_config SET value = '' WHERE key = 'menuAgentDailyJobCap';

    -- the oldest request first; the job is taken (running, attempt 1) and carries the step limit
    SELECT * INTO v_claim FROM public.claim_menu_agent_job();
    ASSERT v_claim.job_place_id = 'test160place0010', 'the oldest request is handed out first';
    ASSERT v_claim.job_name = 'First Cafe' AND v_claim.job_url = 'https://first.example.com', 'name and link are handed out';
    ASSERT v_claim.job_max_steps = 7, 'the step limit setting is handed out';
    ASSERT (SELECT status FROM public.menu_agent_jobs WHERE id = v_claim.job_id) = 'running', 'the claimed job is running';
    ASSERT (SELECT attempts FROM public.menu_agent_jobs WHERE id = v_claim.job_id) = 1, 'the attempt is counted';
    ASSERT (SELECT claimed_at FROM public.menu_agent_jobs WHERE id = v_claim.job_id) IS NOT NULL, 'the claim time is set';

    -- the next call gets the other job, then nothing (a running job is not handed out twice)
    SELECT * INTO v_claim FROM public.claim_menu_agent_job();
    ASSERT v_claim.job_place_id = 'test160place0011', 'the next call gets the next job';
    SELECT COUNT(*) INTO v_n FROM public.claim_menu_agent_job();
    ASSERT v_n = 0, 'running jobs are not handed out twice';

    -- the step limit is bounded to 1..50, and an unreadable value falls back to 10
    UPDATE public.app_config SET value = '500' WHERE key = 'menuAgentMaxSteps';
    UPDATE public.menu_agent_jobs SET status = 'pending', next_attempt_at = NOW() WHERE place_id = 'test160place0010';
    SELECT * INTO v_claim FROM public.claim_menu_agent_job();
    ASSERT v_claim.job_max_steps = 50, 'a step limit above 50 is held at 50';
    UPDATE public.app_config SET value = 'abc' WHERE key = 'menuAgentMaxSteps';
    UPDATE public.menu_agent_jobs SET status = 'pending', next_attempt_at = NOW() WHERE place_id = 'test160place0010';
    SELECT * INTO v_claim FROM public.claim_menu_agent_job();
    ASSERT v_claim.job_max_steps = 10, 'an unreadable step limit falls back to 10';

    RAISE EXCEPTION 'rollback_test_160';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_160' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 4 (claim: switch, caps, order, step limit)';
END $$;


-- ── Block 5: claim_menu_agent_job (retries, stuck jobs, finished jobs) ──────
DO $$
DECLARE
  v_claim RECORD;
  v_n     INTEGER;
BEGIN
  BEGIN
    DELETE FROM public.menu_agent_jobs;
    UPDATE public.app_config SET value = 'true' WHERE key = 'menuAgentEnabled';
    UPDATE public.app_config SET value = '' WHERE key IN ('menuAgentDailyTokenCap', 'menuAgentDailyJobCap');

    -- an error waits for its retry time
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, next_attempt_at)
    VALUES ('test160place0012', 'Error Cafe', 'https://error.example.com', 'error', 1, NOW() + INTERVAL '3 hours');
    SELECT COUNT(*) INTO v_n FROM public.claim_menu_agent_job();
    ASSERT v_n = 0, 'an error is not retried before its time';
    UPDATE public.menu_agent_jobs SET next_attempt_at = NOW() - INTERVAL '1 minute';
    SELECT * INTO v_claim FROM public.claim_menu_agent_job();
    ASSERT v_claim.job_place_id = 'test160place0012', 'an error is retried once its time has come';
    ASSERT (SELECT attempts FROM public.menu_agent_jobs WHERE id = v_claim.job_id) = 2, 'the retry is counted';

    -- a job stuck running for over 30 minutes is handed out again; a recent one is not
    DELETE FROM public.menu_agent_jobs;
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, claimed_at)
    VALUES ('test160place0013', 'Stuck Cafe', 'https://stuck.example.com', 'running', 1, NOW() - INTERVAL '10 minutes');
    SELECT COUNT(*) INTO v_n FROM public.claim_menu_agent_job();
    ASSERT v_n = 0, 'a job running for 10 minutes is left alone';
    UPDATE public.menu_agent_jobs SET claimed_at = NOW() - INTERVAL '31 minutes';
    SELECT * INTO v_claim FROM public.claim_menu_agent_job();
    ASSERT v_claim.job_place_id = 'test160place0013', 'a job stuck for 31 minutes is handed out again';
    ASSERT (SELECT attempts FROM public.menu_agent_jobs WHERE id = v_claim.job_id) = 2, 'the second hand-out is counted';

    -- finished and flagged jobs are never handed out
    DELETE FROM public.menu_agent_jobs;
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, next_attempt_at) VALUES
      ('test160place0014', 'Done', 'https://d.example.com', 'done', NOW() - INTERVAL '1 day'),
      ('test160place0015', 'None', 'https://n.example.com', 'no_items', NOW() - INTERVAL '1 day'),
      ('test160place0016', 'Flagged', 'https://f.example.com', 'needs_attention', 'infinity');
    SELECT COUNT(*) INTO v_n FROM public.claim_menu_agent_job();
    ASSERT v_n = 0, 'done, no_items and needs_attention jobs are never handed out';

    RAISE EXCEPTION 'rollback_test_160';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_160' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 5 (claim: retries, stuck jobs, finished jobs)';
END $$;


-- ── Block 6: record_menu_agent_step ─────────────────────────────────────────
DO $$
DECLARE
  v_job   BIGINT;
  v_other BIGINT;
  v_res   TEXT;
BEGIN
  BEGIN
    DELETE FROM public.menu_agent_jobs;
    UPDATE public.app_config SET value = '3' WHERE key = 'menuAgentMaxSteps';
    UPDATE public.app_config SET value = '' WHERE key IN ('menuAgentDailyTokenCap', 'menuAgentDailyJobCap');

    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, claimed_at)
    VALUES ('test160place0020', 'Step Cafe', 'https://step.example.com', 'running', 1, NOW()) RETURNING id INTO v_job;
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status)
    VALUES ('test160place0021', 'Idle Cafe', 'https://idle.example.com', 'pending') RETURNING id INTO v_other;

    -- a job that does not exist, or is not running, is refused and nothing is stored
    ASSERT public.record_menu_agent_step(-1, 'read_page', NULL, NULL, 1, 1) = 'unknown', 'no such job';
    ASSERT public.record_menu_agent_step(v_other, 'read_page', NULL, NULL, 1, 1) = 'unknown', 'a pending job takes no steps';
    ASSERT NOT EXISTS (SELECT 1 FROM public.menu_agent_steps WHERE job_id = v_other), 'nothing stored for a pending job';

    -- a step is stored, numbered from 1, and its tokens are added to the job
    ASSERT public.record_menu_agent_step(v_job, '  read_page ', 'https://step.example.com/menu', 'qwen-test', 100, 20, 'first page') = 'ok', 'step 1 is ok';
    ASSERT (SELECT step_no FROM public.menu_agent_steps WHERE job_id = v_job) = 1, 'the first step is number 1';
    ASSERT (SELECT action FROM public.menu_agent_steps WHERE job_id = v_job AND step_no = 1) = 'read_page', 'the action is trimmed';
    ASSERT (SELECT model FROM public.menu_agent_steps WHERE job_id = v_job AND step_no = 1) = 'qwen-test', 'the model is stored';
    ASSERT (SELECT steps_taken FROM public.menu_agent_jobs WHERE id = v_job) = 1, 'the job counts the step';
    ASSERT (SELECT input_tokens FROM public.menu_agent_jobs WHERE id = v_job) = 100, 'input tokens added to the job';
    ASSERT (SELECT output_tokens FROM public.menu_agent_jobs WHERE id = v_job) = 20, 'output tokens added to the job';

    -- bad token counts count as 0; a blank action is stored as unknown; long text is cut
    ASSERT public.record_menu_agent_step(v_job, '   ', NULL, NULL, -50, NULL, repeat('x', 900)) = 'ok', 'step 2 with odd values is ok';
    ASSERT (SELECT action FROM public.menu_agent_steps WHERE job_id = v_job AND step_no = 2) = 'unknown', 'a blank action is stored as unknown';
    ASSERT (SELECT input_tokens + output_tokens FROM public.menu_agent_steps WHERE job_id = v_job AND step_no = 2) = 0, 'negative and missing tokens count as 0';
    ASSERT (SELECT length(detail) FROM public.menu_agent_steps WHERE job_id = v_job AND step_no = 2) = 500, 'the detail is cut to 500';
    ASSERT (SELECT input_tokens FROM public.menu_agent_jobs WHERE id = v_job) = 100, 'the job total is not reduced by a negative';

    -- the step limit (3): the third step is the last that is stored; the fourth is refused
    ASSERT public.record_menu_agent_step(v_job, 'read_image', NULL, NULL, 10, 5) = 'ok', 'step 3 is ok';
    ASSERT public.record_menu_agent_step(v_job, 'read_page', NULL, NULL, 10, 5) = 'max_steps', 'step 4 is refused at the limit';
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_steps WHERE job_id = v_job) = 3, 'no fourth step stored';
    ASSERT (SELECT steps_taken FROM public.menu_agent_jobs WHERE id = v_job) = 3, 'the job still counts 3';
    ASSERT (SELECT input_tokens FROM public.menu_agent_jobs WHERE id = v_job) = 110, 'a refused step adds no tokens';

    -- a daily token cap that the step reaches is reported (the step itself is kept)
    DELETE FROM public.menu_agent_steps;
    UPDATE public.menu_agent_jobs SET steps_taken = 0, input_tokens = 0, output_tokens = 0 WHERE id = v_job;
    UPDATE public.app_config SET value = '50' WHERE key = 'menuAgentDailyTokenCap';
    ASSERT public.record_menu_agent_step(v_job, 'read_page', NULL, NULL, 30, 10) = 'ok', '40 of 50 tokens is ok';
    ASSERT public.record_menu_agent_step(v_job, 'read_page', NULL, NULL, 5, 5) = 'cap_reached', '50 of 50 tokens reports cap_reached';
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_steps WHERE job_id = v_job) = 2, 'the step that reached the cap is kept';

    RAISE EXCEPTION 'rollback_test_160';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_160' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 6 (record step)';
END $$;


-- ── Block 7: finish_menu_agent_job ──────────────────────────────────────────
DO $$
DECLARE
  v_job BIGINT;
  v_res TEXT;
BEGIN
  BEGIN
    DELETE FROM public.menu_agent_jobs;
    UPDATE public.app_config SET value = '3' WHERE key = 'menuBuildMaxAttempts';

    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, claimed_at)
    VALUES ('test160place0030', 'Finish Cafe', 'https://finish.example.com', 'running', 1, NOW()) RETURNING id INTO v_job;

    -- unknown job, or a job that is not running
    ASSERT public.finish_menu_agent_job(-1, 'ok', NULL, '[]') = 'unknown', 'no such job';
    UPDATE public.menu_agent_jobs SET status = 'pending' WHERE id = v_job;
    ASSERT public.finish_menu_agent_job(v_job, 'ok', NULL, '[]') = 'unknown', 'a pending job cannot be finished';
    UPDATE public.menu_agent_jobs SET status = 'running' WHERE id = v_job;

    -- ok with dishes: pending proposals only; blank names skipped; text cut; bad prices dropped; menu_items untouched
    v_res := public.finish_menu_agent_job(v_job, 'ok', 'found a menu', jsonb_build_array(
      jsonb_build_object('name', '  Margherita ', 'description', ' Tomato and basil ', 'price', 11.456, 'source_url', 'https://finish.example.com/menu'),
      jsonb_build_object('name', 'Free Water', 'price', 0),
      jsonb_build_object('name', 'Bad Price', 'price', -3),
      jsonb_build_object('name', 'Huge Price', 'price', 1000000),
      jsonb_build_object('name', '   ', 'price', 5),
      jsonb_build_object('description', 'no name at all'),
      jsonb_build_object('name', repeat('n', 300), 'description', repeat('d', 1500))));
    ASSERT v_res = 'done', 'dishes found: the job is done';
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_proposals WHERE job_id = v_job) = 5, 'five usable dishes are stored';
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_proposals WHERE job_id = v_job AND status = 'pending') = 5, 'all are pending';
    ASSERT (SELECT item_name FROM public.menu_agent_proposals WHERE job_id = v_job AND item_name LIKE 'Margherita%') = 'Margherita', 'the name is trimmed';
    ASSERT (SELECT description FROM public.menu_agent_proposals WHERE job_id = v_job AND item_name = 'Margherita') = 'Tomato and basil', 'the description is trimmed';
    ASSERT (SELECT price FROM public.menu_agent_proposals WHERE job_id = v_job AND item_name = 'Margherita') = 11.46, 'the price is rounded to cents';
    ASSERT (SELECT price FROM public.menu_agent_proposals WHERE job_id = v_job AND item_name = 'Free Water') = 0, 'a free item keeps price 0';
    ASSERT (SELECT price FROM public.menu_agent_proposals WHERE job_id = v_job AND item_name = 'Bad Price') IS NULL, 'a negative price is dropped';
    ASSERT (SELECT price FROM public.menu_agent_proposals WHERE job_id = v_job AND item_name = 'Huge Price') IS NULL, 'a huge price is dropped';
    ASSERT (SELECT MAX(length(item_name)) FROM public.menu_agent_proposals WHERE job_id = v_job) = 200, 'a long name is cut to 200';
    ASSERT (SELECT MAX(length(description)) FROM public.menu_agent_proposals WHERE job_id = v_job) = 1000, 'a long description is cut to 1000';
    ASSERT (SELECT place_id FROM public.menu_agent_proposals WHERE job_id = v_job LIMIT 1) = 'test160place0030', 'proposals carry the place';
    ASSERT (SELECT status FROM public.menu_agent_jobs WHERE id = v_job) = 'done', 'job row is done';
    ASSERT (SELECT finished_at FROM public.menu_agent_jobs WHERE id = v_job) IS NOT NULL, 'finish time is set';
    ASSERT (SELECT last_detail FROM public.menu_agent_jobs WHERE id = v_job) = 'found a menu', 'detail is stored';
    ASSERT NOT EXISTS (SELECT 1 FROM public.menu_items WHERE place_id = 'test160place0030'), 'menu_items is not touched';
    ASSERT public.finish_menu_agent_job(v_job, 'ok', NULL, '[]') = 'unknown', 'a finished job cannot be finished again';

    -- ok but nothing usable (empty, not an array, or only blank names): no_items
    FOR v_res IN SELECT unnest(ARRAY['[]', '{"name":"x"}', 'null', '[{"name":"  "}]']) LOOP
      UPDATE public.menu_agent_jobs SET status = 'running' WHERE id = v_job;
      ASSERT public.finish_menu_agent_job(v_job, 'ok', NULL, v_res::jsonb) = 'no_items', 'nothing usable (' || v_res || ') is no_items';
    END LOOP;
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_proposals WHERE job_id = v_job) = 5, 'no proposals added by those';

    -- no_items status
    UPDATE public.menu_agent_jobs SET status = 'running' WHERE id = v_job;
    ASSERT public.finish_menu_agent_job(v_job, 'no_items', 'page had no dishes') = 'no_items', 'no_items is reported';

    -- an error is retried after 6 hours; at the attempt limit it is flagged and never retried
    UPDATE public.menu_agent_jobs SET status = 'running', attempts = 1 WHERE id = v_job;
    ASSERT public.finish_menu_agent_job(v_job, 'error', repeat('e', 500)) = 'error', 'attempt 1 of 3: error';
    ASSERT (SELECT length(last_detail) FROM public.menu_agent_jobs WHERE id = v_job) = 300, 'the detail is cut to 300';
    ASSERT (SELECT next_attempt_at FROM public.menu_agent_jobs WHERE id = v_job) BETWEEN NOW() + INTERVAL '5 hours 59 minutes' AND NOW() + INTERVAL '6 hours 1 minute', 'retry in 6 hours';
    UPDATE public.menu_agent_jobs SET status = 'running', attempts = 3 WHERE id = v_job;
    ASSERT public.finish_menu_agent_job(v_job, 'weird_status', NULL) = 'needs_attention', 'attempt 3 of 3: needs_attention';
    ASSERT (SELECT next_attempt_at FROM public.menu_agent_jobs WHERE id = v_job) = 'infinity', 'a flagged job is never retried';

    RAISE EXCEPTION 'rollback_test_160';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_160' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 7 (finish)';
END $$;


-- ── Block 8: admin_list_menu_agent_proposals / admin_decide_menu_agent_proposals ──
DO $$
DECLARE
  v_admin UUID;
  v_job   BIGINT;
  v_ids   BIGINT[];
  v_n     INTEGER;
BEGIN
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin to try the behaviour on; block 8 skipped (wiring checks were done in block 1)';
    RETURN;
  END IF;

  BEGIN
    DELETE FROM public.menu_agent_jobs;
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, claimed_at)
    VALUES ('test160place0040', 'Admin Cafe', 'https://admin.example.com', 'running', 1, NOW()) RETURNING id INTO v_job;
    PERFORM public.finish_menu_agent_job(v_job, 'ok', NULL, jsonb_build_array(
      jsonb_build_object('name', 'Dish One'), jsonb_build_object('name', 'Dish Two'), jsonb_build_object('name', 'Dish Three')));
    SELECT array_agg(p.id ORDER BY p.id) INTO v_ids FROM public.menu_agent_proposals p WHERE p.job_id = v_job;

    -- a non-admin is refused by both
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    BEGIN
      PERFORM * FROM public.admin_list_menu_agent_proposals('pending', 10, 0);
      RAISE EXCEPTION 'a non-admin listed proposals';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a non-admin listed proposals' THEN RAISE; END IF; END;
    BEGIN
      PERFORM public.admin_decide_menu_agent_proposals(v_ids, TRUE);
      RAISE EXCEPTION 'a non-admin decided proposals';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a non-admin decided proposals' THEN RAISE; END IF; END;
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_proposals WHERE status = 'pending') = 3, 'the refused attempts changed nothing';

    -- an admin lists the pending ones, oldest first, with the restaurant name and the total
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    SELECT COUNT(*) INTO v_n FROM public.admin_list_menu_agent_proposals('pending', 50, 0);
    ASSERT v_n = 3, 'the admin sees three pending proposals';
    ASSERT (SELECT MIN(total_count) FROM public.admin_list_menu_agent_proposals('pending', 2, 0)) = 3, 'the total is the full count';
    ASSERT (SELECT COUNT(*) FROM public.admin_list_menu_agent_proposals('pending', 2, 0)) = 2, 'the limit is applied';
    ASSERT (SELECT COUNT(*) FROM public.admin_list_menu_agent_proposals('pending', 2, 2)) = 1, 'the offset is applied';
    ASSERT (SELECT restaurant_name FROM public.admin_list_menu_agent_proposals('pending', 1, 0)) = 'Admin Cafe', 'the restaurant name is joined in';
    ASSERT (SELECT item_name FROM public.admin_list_menu_agent_proposals('pending', 1, 0)) = 'Dish One', 'oldest first';
    ASSERT (SELECT COUNT(*) FROM public.admin_list_menu_agent_proposals('', 50, 0)) = 3, 'a blank status means pending';
    ASSERT (SELECT COUNT(*) FROM public.admin_list_menu_agent_proposals('approved', 50, 0)) = 0, 'none approved yet';
    ASSERT (SELECT COUNT(*) FROM public.admin_list_menu_agent_proposals('pending', 0, -5)) = 1, 'limit 0 is held at 1, a negative offset at 0';

    -- decide: approve two, reject one; a decided proposal is not changed again
    ASSERT public.admin_decide_menu_agent_proposals(ARRAY[v_ids[1], v_ids[2]], TRUE) = 2, 'two approved';
    ASSERT public.admin_decide_menu_agent_proposals(ARRAY[v_ids[3]], FALSE) = 1, 'one rejected';
    ASSERT public.admin_decide_menu_agent_proposals(v_ids, FALSE) = 0, 'decided proposals are not changed again';
    ASSERT public.admin_decide_menu_agent_proposals(NULL, TRUE) = 0, 'no ids: nothing changes';
    ASSERT public.admin_decide_menu_agent_proposals(ARRAY[-1::BIGINT], TRUE) = 0, 'unknown id: nothing changes';
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_proposals WHERE status = 'approved') = 2, 'two stay approved';
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_proposals WHERE status = 'rejected') = 1, 'one stays rejected';
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_proposals WHERE decided_by = v_admin AND decided_at IS NOT NULL) = 3, 'who and when are recorded';
    ASSERT (SELECT COUNT(*) FROM public.admin_list_menu_agent_proposals('approved', 50, 0)) = 2, 'the admin lists the approved ones';
    ASSERT (SELECT COUNT(*) FROM public.admin_list_menu_agent_proposals('pending', 50, 0)) = 0, 'no pending left';
    ASSERT NOT EXISTS (SELECT 1 FROM public.menu_items WHERE place_id = 'test160place0040'), 'approving does not touch menu_items';

    RAISE EXCEPTION 'rollback_test_160';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_160' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 8 (admin list and decide)';
END $$;


-- ── Block 9: merge_approved_menu_agent_proposals ────────────────────────────
DO $$
DECLARE
  v_job BIGINT;
  v_ids BIGINT[];
  v_res JSONB;
BEGIN
  BEGIN
    DELETE FROM public.menu_agent_jobs;
    INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url, status, attempts, claimed_at)
    VALUES ('test160place0050', 'Merge Cafe', 'https://merge.example.com', 'running', 1, NOW()) RETURNING id INTO v_job;
    PERFORM public.finish_menu_agent_job(v_job, 'ok', NULL, jsonb_build_array(
      jsonb_build_object('name', 'Approved Dish'), jsonb_build_object('name', 'Pending Dish'),
      jsonb_build_object('name', 'Rejected Dish'), jsonb_build_object('name', 'Guessed Dish')));
    SELECT array_agg(p.id ORDER BY p.id) INTO v_ids FROM public.menu_agent_proposals p WHERE p.job_id = v_job;
    UPDATE public.menu_agent_proposals SET status = 'approved' WHERE id IN (v_ids[1], v_ids[4]);
    UPDATE public.menu_agent_proposals SET status = 'rejected' WHERE id = v_ids[3];

    -- an existing AI guess that an approved dish matches is confirmed, not duplicated
    INSERT INTO public.menu_items (item_id, restaurant_name, name, place_id, is_verified)
    VALUES ('ai_test160guess', 'Merge Cafe', 'Guessed Dish', 'test160place0050', FALSE);

    -- bad input
    BEGIN
      PERFORM public.merge_approved_menu_agent_proposals('test160place0050', 'Merge Cafe', '{"a":1}'::jsonb);
      RAISE EXCEPTION 'a non-array was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a non-array was accepted' THEN RAISE; END IF; END;

    -- only approved, unmerged proposals of THIS place are merged; the rest are skipped
    v_res := public.merge_approved_menu_agent_proposals('test160place0050', 'Merge Cafe', jsonb_build_array(
      jsonb_build_object('proposalId', v_ids[1], 'itemId', 'manual_approved', 'name', 'Approved Dish', 'calories', 500),
      jsonb_build_object('proposalId', v_ids[2], 'itemId', 'manual_pending', 'name', 'Pending Dish'),
      jsonb_build_object('proposalId', v_ids[3], 'itemId', 'manual_rejected', 'name', 'Rejected Dish'),
      jsonb_build_object('proposalId', v_ids[4], 'itemId', 'manual_guessed', 'name', 'Guessed Dish'),
      jsonb_build_object('proposalId', 999999999, 'itemId', 'manual_unknown', 'name', 'Unknown Dish'),
      jsonb_build_object('itemId', 'manual_noid', 'name', 'No Proposal Dish')));
    ASSERT (v_res->>'added')::INT = 1, 'one new dish added';
    ASSERT (v_res->>'confirmed')::INT = 1, 'one AI guess confirmed';
    ASSERT (v_res->>'skipped')::INT = 4, 'four skipped (pending, rejected, unknown id, no id)';
    ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE place_id = 'test160place0050' AND name = 'Approved Dish' AND is_verified),
      'the approved dish is on the menu, verified';
    ASSERT (SELECT is_verified FROM public.menu_items WHERE item_id = 'ai_test160guess'), 'the AI guess is now verified';
    ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE place_id = 'test160place0050' AND name = 'Guessed Dish') = 1, 'no second copy of the guessed dish';
    ASSERT NOT EXISTS (SELECT 1 FROM public.menu_items WHERE place_id = 'test160place0050' AND name IN ('Pending Dish', 'Rejected Dish', 'Unknown Dish', 'No Proposal Dish')),
      'pending, rejected and unknown dishes are not on the menu';
    ASSERT (SELECT COUNT(*) FROM public.menu_agent_proposals WHERE merged_at IS NOT NULL) = 2, 'the two merged proposals are marked merged';
    ASSERT (SELECT merged_at FROM public.menu_agent_proposals WHERE id = v_ids[2]) IS NULL, 'a pending proposal is not marked merged';

    -- merging again does nothing: both are already merged
    v_res := public.merge_approved_menu_agent_proposals('test160place0050', 'Merge Cafe', jsonb_build_array(
      jsonb_build_object('proposalId', v_ids[1], 'itemId', 'manual_approved', 'name', 'Approved Dish')));
    ASSERT (v_res->>'added')::INT = 0 AND (v_res->>'confirmed')::INT = 0 AND (v_res->>'skipped')::INT = 1, 'a merged proposal is skipped';

    -- a proposal of another place is never merged under this place
    UPDATE public.menu_agent_proposals SET merged_at = NULL WHERE id = v_ids[1];
    v_res := public.merge_approved_menu_agent_proposals('test160place0051', 'Other Cafe', jsonb_build_array(
      jsonb_build_object('proposalId', v_ids[1], 'itemId', 'manual_other', 'name', 'Approved Dish')));
    ASSERT (v_res->>'skipped')::INT = 1 AND (v_res->>'added')::INT = 0, 'another place cannot merge this proposal';
    ASSERT NOT EXISTS (SELECT 1 FROM public.menu_items WHERE place_id = 'test160place0051'), 'nothing added to the other place';

    -- an empty list is fine
    v_res := public.merge_approved_menu_agent_proposals('test160place0050', 'Merge Cafe', '[]'::jsonb);
    ASSERT (v_res->>'added')::INT = 0 AND (v_res->>'skipped')::INT = 0, 'an empty list merges nothing';

    RAISE EXCEPTION 'rollback_test_160';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_160' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: block 9 (merge approved proposals)';
  RAISE NOTICE 'ALL 160 TESTS PASSED';
END $$;


-- Test for migration 101: the menu build queue. Runs for real inside a transaction that is rolled back.
-- Requires migrations 062, 072, 100 and 101. Success: no error (Notices show PASS lines).
BEGIN;

-- Fixtures: stores the app has "seen", a franchise chain and one of its stores.
INSERT INTO public.cached_restaurants (place_id, name) VALUES
  ('ChIJzzq3placeAAAAAAAAAAA1', 'ZZ Q3 Cafe'),
  ('ChIJzzq3placeBBBBBBBBBBB2', 'ZZ Q3 Bistro'),
  ('ChIJzzq3placeCCCCCCCCCCC3', 'ZZ Q3 Diner'),
  ('ChIJzzq3placeDDDDDDDDDDD4', 'ZZ Q3 Chain');
INSERT INTO public.franchise_chains (name, aliases) VALUES ('ZZ Q3 Chain', ARRAY[]::text[]);

DO $$
DECLARE
  a CONSTANT TEXT := 'ChIJzzq3placeAAAAAAAAAAA1';
  b CONSTANT TEXT := 'ChIJzzq3placeBBBBBBBBBBB2';
  c CONSTANT TEXT := 'ChIJzzq3placeCCCCCCCCCCC3';
  d CONSTANT TEXT := 'ChIJzzq3placeDDDDDDDDDDD4';
  job_a BIGINT; job_b BIGINT; job_c BIGINT; job_chain BIGINT;
  result TEXT;
  n INTEGER;
BEGIN
  -- enqueue: bad input, unknown place, new, repeat
  ASSERT public.enqueue_menu_build('short', 'ZZ Q3 Cafe') = 'invalid', 'a bad place id is refused';
  ASSERT public.enqueue_menu_build(a, '   ') = 'invalid', 'a blank name is refused';
  ASSERT public.enqueue_menu_build('ChIJnotcachedXXXXXXXXXXXX9', 'Made Up Place') = 'unknown_place', 'a place never seen is ignored';
  ASSERT NOT EXISTS (SELECT 1 FROM public.menu_build_queue WHERE place_id = 'ChIJnotcachedXXXXXXXXXXXX9'), 'nothing is queued for it';
  ASSERT public.enqueue_menu_build(a, 'ZZ Q3 Cafe') = 'queued', 'a seen place is queued';
  ASSERT public.enqueue_menu_build(a, 'ZZ Q3 Cafe') = 'already_queued', 'a second request is not a second job';
  ASSERT (SELECT requested_count FROM public.menu_build_queue WHERE place_id = a) = 2, 'but its request count goes up';
  ASSERT (SELECT COUNT(*) FROM public.menu_build_queue WHERE place_id = a) = 1, 'one job per place';
  RAISE NOTICE 'PASS: enqueue handles bad input, unknown places and repeats';

  -- a place that already has a menu is not queued
  INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, place_id) VALUES ('manual_zzq3_1', 'ZZ Q3 Bistro', 'Soup', true, b);
  ASSERT public.enqueue_menu_build(b, 'ZZ Q3 Bistro') = 'already_built', 'a place with its own menu is already built';
  DELETE FROM public.menu_items WHERE item_id = 'manual_zzq3_1';
  ASSERT public.enqueue_menu_build(b, 'ZZ Q3 Bistro') = 'queued', 'queued once it has none';
  RAISE NOTICE 'PASS: a place with a menu is not queued';

  -- a chain is queued as ONE chain job whichever store was opened, and not again once built
  ASSERT public.enqueue_menu_build(d, 'ZZ Q3 Chain #44') = 'queued', 'a store of a chain queues the chain';
  ASSERT (SELECT kind FROM public.menu_build_queue WHERE restaurant_name = 'ZZ Q3 Chain') = 'chain', 'it is a chain job';
  ASSERT (SELECT place_id FROM public.menu_build_queue WHERE restaurant_name = 'ZZ Q3 Chain') IS NULL, 'with no place id';
  ASSERT public.enqueue_menu_build(d, 'ZZ Q3 Chain') = 'already_queued', 'another store of the chain is the same job';
  INSERT INTO public.franchise_menu_sources (chain_id, status) SELECT id, 'ok' FROM public.franchise_chains WHERE name = 'ZZ Q3 Chain'
    ON CONFLICT (chain_id) DO UPDATE SET status = 'ok';
  DELETE FROM public.menu_build_queue WHERE restaurant_name = 'ZZ Q3 Chain';
  ASSERT public.enqueue_menu_build(d, 'ZZ Q3 Chain') = 'already_built', 'a built chain is not queued';
  DELETE FROM public.franchise_menu_sources WHERE status = 'ok' AND chain_id = (SELECT id FROM public.franchise_chains WHERE name = 'ZZ Q3 Chain');
  ASSERT public.enqueue_menu_build(d, 'ZZ Q3 Chain') = 'queued', 'queued again when it has no built menu';
  RAISE NOTICE 'PASS: chains are one job each';

  -- the queue is bounded
  UPDATE public.app_config SET value = '1' WHERE key = 'menuQueueMaxWaiting';   -- jobs for a, b and the chain are already waiting
  ASSERT public.enqueue_menu_build(c, 'ZZ Q3 Diner') = 'queue_full', 'a full queue refuses a new job';
  ASSERT public.enqueue_menu_build(a, 'ZZ Q3 Cafe') = 'already_queued', 'but a repeat request for a waiting job is still counted';
  UPDATE public.app_config SET value = '5000' WHERE key = 'menuQueueMaxWaiting';
  ASSERT public.enqueue_menu_build(c, 'ZZ Q3 Diner') = 'queued', 'and accepts them again when there is room';
  RAISE NOTICE 'PASS: the queue is bounded';

  -- claim: busiest first, building, attempt counted, not taken twice
  PERFORM public.enqueue_menu_build(b, 'ZZ Q3 Bistro');
  PERFORM public.enqueue_menu_build(b, 'ZZ Q3 Bistro');
  SELECT id INTO job_a FROM public.menu_build_queue WHERE place_id = a;
  SELECT id INTO job_b FROM public.menu_build_queue WHERE place_id = b;
  SELECT id INTO job_c FROM public.menu_build_queue WHERE place_id = c;
  SELECT id INTO job_chain FROM public.menu_build_queue WHERE restaurant_name = 'ZZ Q3 Chain';
  -- Any real jobs already in your queue must not be picked up by this test (rolled back with everything else).
  UPDATE public.menu_build_queue SET status = 'needs_attention', next_attempt_at = 'infinity'
    WHERE id NOT IN (job_a, job_b, job_c, job_chain);
  -- Set the request counts explicitly: b is the busiest (5 requests), then a (3), then c (1).
  UPDATE public.menu_build_queue SET requested_count = 5 WHERE id = job_b;
  UPDATE public.menu_build_queue SET requested_count = 3 WHERE id = job_a;
  UPDATE public.menu_build_queue SET requested_count = 1 WHERE id = job_c;
  -- take just the busiest ONE place job (the chain job is kept out of this step)
  UPDATE public.menu_build_queue SET next_attempt_at = NOW() + INTERVAL '1 day' WHERE kind = 'chain';
  SELECT COUNT(*) INTO n FROM public.claim_menu_builds(0, 1);
  ASSERT n = 1, 'the place limit is respected';
  ASSERT (SELECT status FROM public.menu_build_queue WHERE id = job_b) = 'building', 'the busiest place (5 requests) is taken first';
  ASSERT (SELECT attempts FROM public.menu_build_queue WHERE id = job_b) = 1, 'the attempt is counted';
  ASSERT (SELECT status FROM public.menu_build_queue WHERE id = job_a) = 'waiting', 'the others wait';
  SELECT COUNT(*) INTO n FROM public.claim_menu_builds(0, 5);
  ASSERT n = 2 AND NOT EXISTS (SELECT 1 FROM public.claim_menu_builds(0, 5)), 'the rest are taken once, and a building job is not taken again';
  RAISE NOTICE 'PASS: claim takes the busiest first and never twice';

  -- the chain limit is separate from the place limit
  UPDATE public.menu_build_queue SET next_attempt_at = NOW() WHERE kind = 'chain';
  ASSERT (SELECT COUNT(*) FROM public.claim_menu_builds(1, 0) WHERE kind = 'chain') = 1, 'chain jobs have their own limit';
  ASSERT (SELECT status FROM public.menu_build_queue WHERE id = job_chain) = 'building', 'the chain job is building';
  RAISE NOTICE 'PASS: chain and place limits are separate';

  -- a build that was cut off (stuck building) comes back
  UPDATE public.menu_build_queue SET started_at = NOW() - INTERVAL '1 hour' WHERE id = job_b;
  ASSERT EXISTS (SELECT 1 FROM public.claim_menu_builds(0, 5) WHERE job_id = job_b), 'a job stuck building for over 10 minutes is due again';
  ASSERT (SELECT attempts FROM public.menu_build_queue WHERE id = job_b) = 2, 'and the second try is counted';
  RAISE NOTICE 'PASS: a cut-off build is retried';

  -- results: retry delays
  result := public.finish_menu_build(job_b, 'error', 'timed out');
  ASSERT result = 'error', 'an error is recorded';
  ASSERT (SELECT next_attempt_at FROM public.menu_build_queue WHERE id = job_b) BETWEEN NOW() + INTERVAL '5 hours 50 minutes' AND NOW() + INTERVAL '6 hours 10 minutes', 'an error waits about 6 hours';
  result := public.finish_menu_build(job_b, 'unreadable', 'a scan');
  ASSERT (SELECT next_attempt_at FROM public.menu_build_queue WHERE id = job_b) BETWEEN NOW() + INTERVAL '71 hours' AND NOW() + INTERVAL '73 hours', 'an unreadable page waits about 72 hours';
  result := public.finish_menu_build(job_b, 'no_menu_link');
  ASSERT result = 'no_menu_link', 'no menu link is recorded';
  RAISE NOTICE 'PASS: retry delays';

  -- too many failures: needs attention, and never claimed again
  UPDATE public.menu_build_queue SET attempts = 3 WHERE id = job_b;
  result := public.finish_menu_build(job_b, 'error', 'again');
  ASSERT result = 'needs_attention', 'after 3 failed tries it needs attention';
  UPDATE public.menu_build_queue SET next_attempt_at = NOW() - INTERVAL '1 day' WHERE id = job_b;
  ASSERT NOT EXISTS (SELECT 1 FROM public.claim_menu_builds(10, 10) WHERE job_id = job_b), 'a needs-attention job is never taken';
  RAISE NOTICE 'PASS: repeated failures are flagged and stop';

  -- adding a menu another way clears the flag; an admin can also retry
  PERFORM public.resolve_place_menu_build(b);
  ASSERT (SELECT status FROM public.menu_build_queue WHERE id = job_b) = 'built', 'saving a menu clears the flag';
  ASSERT (SELECT attempts FROM public.menu_build_queue WHERE id = job_b) = 0, 'and resets the attempts';
  UPDATE public.menu_build_queue SET status = 'needs_attention', attempts = 3, next_attempt_at = 'infinity' WHERE id = job_b;
  PERFORM public.requeue_menu_build(job_b);
  ASSERT (SELECT status FROM public.menu_build_queue WHERE id = job_b) = 'waiting', 'a retry puts it back in the queue';
  RAISE NOTICE 'PASS: resolve and retry';

  -- success: built, due again after the refresh period
  result := public.finish_menu_build(job_a, 'ok', 'built');
  ASSERT result = 'built', 'a good result is built';
  ASSERT (SELECT next_attempt_at FROM public.menu_build_queue WHERE id = job_a) BETWEEN NOW() + INTERVAL '89 days' AND NOW() + INTERVAL '91 days', 'a place is refreshed after about 90 days';
  ASSERT (SELECT attempts FROM public.menu_build_queue WHERE id = job_a) = 0, 'and its attempts reset';
  ASSERT public.finish_menu_build(job_chain, 'ok') = 'built', 'a chain job can finish too';
  BEGIN
    PERFORM public.finish_menu_build(job_a, 'whatever');
    RAISE EXCEPTION 'an unknown result should have been refused';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE '%Unknown build result%', 'unknown result message. Got ' || SQLERRM;
  END;
  RAISE NOTICE 'PASS: success and bad results';

  -- not reachable from the apps
  ASSERT NOT has_function_privilege('anon', 'public.enqueue_menu_build(text,text)', 'EXECUTE'), 'anon cannot enqueue';
  ASSERT NOT has_function_privilege('authenticated', 'public.enqueue_menu_build(text,text)', 'EXECUTE'), 'signed-in users cannot enqueue';
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_menu_builds(integer,integer)', 'EXECUTE'), 'signed-in users cannot claim';
  ASSERT NOT has_function_privilege('authenticated', 'public.finish_menu_build(bigint,text,text)', 'EXECUTE'), 'signed-in users cannot report results';
  ASSERT has_function_privilege('service_role', 'public.enqueue_menu_build(text,text)', 'EXECUTE'), 'the service role can enqueue';
  ASSERT has_function_privilege('service_role', 'public.claim_menu_builds(integer,integer)', 'EXECUTE'), 'the service role can claim';
  ASSERT NOT has_table_privilege('authenticated', 'public.menu_build_queue', 'SELECT'), 'the queue is not readable through the API';

  RAISE NOTICE 'ALL 101 TESTS PASSED';
END $$;

ROLLBACK;

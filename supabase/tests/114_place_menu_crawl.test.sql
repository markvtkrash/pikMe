-- Test for migration 114: link changes are recorded for the browser crawl, the worker gets its next restaurants, results
-- are recorded, and the secret check works. Everything runs inside a transaction that is rolled back. Needs
-- migrations 101, 102 and 114. Success: no error.
DO $$
DECLARE
  v_place   TEXT := 'ChIJtest114abcdefghij';
  v_other   TEXT := 'ChIJtest114zzzzzzzzzz';
  v_row     public.place_menu_crawl%ROWTYPE;
  v_claimed INTEGER;
BEGIN
  -- access: server only
  ASSERT NOT has_function_privilege('anon', 'public.claim_place_crawls(integer,integer)', 'EXECUTE'), 'anon cannot claim';
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_place_crawls(integer,integer)', 'EXECUTE'), 'signed-in users cannot claim';
  ASSERT has_function_privilege('service_role', 'public.claim_place_crawls(integer,integer)', 'EXECUTE'), 'the server can claim';
  ASSERT NOT has_function_privilege('authenticated', 'public.crawl_run_limit()', 'EXECUTE'), 'signed-in users cannot read the run limit through the function';
  ASSERT has_function_privilege('service_role', 'public.crawl_run_limit()', 'EXECUTE'), 'the server can read the run limit';
  ASSERT EXISTS (SELECT 1 FROM public.app_config c WHERE c.key = 'menuCrawlMaxPerRun'), 'the run limit setting exists';
  ASSERT NOT has_function_privilege('authenticated', 'public.finish_place_crawl(text,text,text,text,integer)', 'EXECUTE'), 'signed-in users cannot report';
  ASSERT NOT has_function_privilege('authenticated', 'public.crawler_secret_ok(text)', 'EXECUTE'), 'signed-in users cannot test secrets';
  ASSERT NOT has_table_privilege('authenticated', 'public.place_menu_crawl', 'SELECT'), 'the table is not readable by signed-in users';
  ASSERT NOT has_table_privilege('anon', 'public.place_menu_crawl', 'SELECT'), 'the table is not readable by anon';
  ASSERT has_table_privilege('service_role', 'public.place_menu_crawl', 'SELECT')
     AND has_table_privilege('service_role', 'public.place_menu_crawl', 'UPDATE'), 'the edge functions (service role) can read and update it';
  ASSERT has_table_privilege('service_role', 'public.menu_build_queue', 'SELECT'), 'the edge functions can read the build queue (the override link)';

  BEGIN
    UPDATE public.app_config SET value = '50' WHERE key = 'menuCrawlMaxPerRun';   -- known starting point (rolled back)

    -- recording a link
    ASSERT public.request_place_crawl('short', 'Cactus Grill', 'https://example.com/menu', 'owner') = 'invalid', 'a bad place id is refused';
    ASSERT public.request_place_crawl(v_place, 'Cactus Grill', 'ftp://example.com/menu', 'owner') = 'invalid', 'only http and https links are accepted';
    ASSERT public.request_place_crawl(v_place, 'Cactus Grill', 'https://example.com/menu', 'someone') = 'invalid', 'the source must be owner or admin';
    ASSERT public.request_place_crawl(v_place, 'Cactus Grill', 'https://example.com/' || repeat('a', 2000), 'owner') = 'invalid', 'a link over 2000 characters is refused';
    ASSERT public.request_place_crawl(v_place, 'Cactus Grill', 'https://exa mple.com/menu', 'owner') = 'invalid', 'a link with a space in it is refused';
    ASSERT public.request_place_crawl(v_place, 'Cactus Grill', 'https://', 'owner') = 'invalid', 'a link with no host is refused';
    ASSERT public.request_place_crawl(v_place, 'Cactus Grill', 'https://example.com/menu', 'owner') = 'queued', 'an owner link is queued';
    SELECT * INTO v_row FROM public.place_menu_crawl c WHERE c.place_id = v_place;
    ASSERT v_row.status = 'pending' AND v_row.link_source = 'owner' AND v_row.attempts = 0, 'it starts pending';

    -- an admin's link wins over the owner's
    INSERT INTO public.menu_build_queue (kind, place_id, restaurant_name, override_link)
    VALUES ('place', v_other, 'Other Place', NULL);
    UPDATE public.menu_build_queue SET override_link = 'https://admin.example.com/menu' WHERE kind = 'place' AND place_id = v_other;
    SELECT * INTO v_row FROM public.place_menu_crawl c WHERE c.place_id = v_other;
    ASSERT v_row.link_source = 'admin' AND v_row.link = 'https://admin.example.com/menu', 'setting an admin override link records a crawl (trigger)';
    -- (migration 114: the owner link is ignored while an admin link is in force; migration 122: the latest save wins)
    ASSERT public.request_place_crawl(v_other, 'Other Place', 'https://owner.example.com/menu', 'owner') IN ('admin_link_in_use', 'queued'), 'an owner link while an admin link is set is handled';
    -- put the admin's link back as the one in force for the steps below
    UPDATE public.place_menu_crawl SET link = 'https://admin.example.com/menu', link_source = 'admin', status = 'pending', next_attempt_at = NOW() WHERE place_id = v_other;

    -- claiming
    SELECT COUNT(*) INTO v_claimed FROM public.claim_place_crawls(20) WHERE job_place_id IN (v_place, v_other);
    ASSERT v_claimed = 2, 'both pending restaurants are handed out';
    ASSERT (SELECT COUNT(*) FROM public.claim_place_crawls(20) WHERE job_place_id IN (v_place, v_other)) = 0, 'a claimed restaurant is not handed out twice';
    SELECT * INTO v_row FROM public.place_menu_crawl c WHERE c.place_id = v_place;
    ASSERT v_row.status = 'crawling' AND v_row.attempts = 1, 'a claimed restaurant is crawling, attempt 1';

    -- the run limit (menuCrawlMaxPerRun): nothing is handed out beyond it, counting what this run already took
    UPDATE public.place_menu_crawl SET status = 'done' WHERE place_id NOT IN (v_place, v_other);   -- isolate the test (rolled back)
    UPDATE public.app_config SET value = '2' WHERE key = 'menuCrawlMaxPerRun';
    ASSERT public.crawl_run_limit() = 2, 'the setting is read';
    UPDATE public.place_menu_crawl SET status = 'pending', next_attempt_at = NOW() WHERE place_id IN (v_place, v_other);
    ASSERT (SELECT COUNT(*) FROM public.claim_place_crawls(20, 1)) = 1, 'with 1 already taken and a limit of 2, only 1 more is handed out';
    UPDATE public.place_menu_crawl SET status = 'pending', next_attempt_at = NOW() WHERE place_id IN (v_place, v_other);
    ASSERT (SELECT COUNT(*) FROM public.claim_place_crawls(20, 2)) = 0, 'nothing is handed out once the limit is reached';
    ASSERT (SELECT COUNT(*) FROM public.claim_place_crawls(20, 500)) = 0, 'or when more than the limit was taken';
    ASSERT (SELECT COUNT(*) FROM public.claim_place_crawls(20, 0)) = 2, 'a fresh run gets up to the limit';
    UPDATE public.app_config SET value = 'banana' WHERE key = 'menuCrawlMaxPerRun';
    ASSERT public.crawl_run_limit() = 50, 'an invalid setting falls back to 50';
    UPDATE public.app_config SET value = '5000' WHERE key = 'menuCrawlMaxPerRun';
    ASSERT public.crawl_run_limit() = 1000, 'a too-large setting is capped at 1000';
    UPDATE public.app_config SET value = '50' WHERE key = 'menuCrawlMaxPerRun';
    UPDATE public.place_menu_crawl SET status = 'crawling', claimed_at = NOW() WHERE place_id IN (v_place, v_other);

    -- results
    ASSERT public.finish_place_crawl(v_place, 'https://other.example.com/x', 'ok', 'x', 3) = 'link_changed', 'a result for an out-of-date link is ignored';
    ASSERT public.finish_place_crawl(v_place, 'https://example.com/menu', 'ok', '3 dishes', 3) = 'done', 'a good result is recorded';
    ASSERT public.finish_place_crawl(v_other, 'https://admin.example.com/menu', 'no_items', 'nothing', 0) = 'no_items', 'a page with no dishes is recorded';
    ASSERT public.finish_place_crawl('ChIJunknown00000000', 'https://x.example.com', 'ok', NULL, 1) = 'unknown', 'an unknown restaurant is reported as unknown';

    -- saving the SAME link again asks for a fresh read, even after a finished crawl
    ASSERT public.request_place_crawl(v_place, 'Cactus Grill', 'https://example.com/menu', 'owner') = 'queued', 'the same link saved again is queued';
    SELECT * INTO v_row FROM public.place_menu_crawl c WHERE c.place_id = v_place;
    ASSERT v_row.status = 'pending' AND v_row.attempts = 0, 'it is pending again after a finished crawl';

    -- ...and a save that arrives while a crawl is running is not lost when that crawl finishes
    PERFORM public.claim_place_crawls(20);
    -- (NOW() does not move inside one transaction, so the later save is simulated by setting its time)
    UPDATE public.place_menu_crawl SET requested_at = claimed_at + INTERVAL '1 second', status = 'pending' WHERE place_id = v_place;
    ASSERT public.finish_place_crawl(v_place, 'https://example.com/menu', 'ok', 'x', 2) = 'requested_again', 'a save during a crawl keeps the newer request queued';
    SELECT * INTO v_row FROM public.place_menu_crawl c WHERE c.place_id = v_place;
    ASSERT v_row.status = 'pending', 'it is still waiting to be read again';

    -- errors are retried after 6 hours, then flagged
    PERFORM public.request_place_crawl(v_place, 'Cactus Grill', 'https://example.com/menu2', 'owner');
    PERFORM public.claim_place_crawls(20);
    ASSERT public.finish_place_crawl(v_place, 'https://example.com/menu2', 'error', 'timeout', NULL) = 'error', 'a first failure is an error to retry';
    SELECT * INTO v_row FROM public.place_menu_crawl c WHERE c.place_id = v_place;
    ASSERT v_row.next_attempt_at > NOW() + INTERVAL '5 hours', 'it is retried after about 6 hours';
    ASSERT (SELECT COUNT(*) FROM public.claim_place_crawls(20) WHERE job_place_id = v_place) = 0, 'not handed out before the retry time';
    UPDATE public.place_menu_crawl SET attempts = 3, status = 'crawling' WHERE place_id = v_place;
    ASSERT public.finish_place_crawl(v_place, 'https://example.com/menu2', 'error', 'again', NULL) = 'needs_attention', 'repeated failures are flagged for an admin';

    -- a new link starts over
    ASSERT public.request_place_crawl(v_place, 'Cactus Grill', 'https://example.com/new', 'admin') = 'queued', 'a new link re-queues a flagged restaurant';
    SELECT * INTO v_row FROM public.place_menu_crawl c WHERE c.place_id = v_place;
    ASSERT v_row.status = 'pending' AND v_row.attempts = 0, 'it is pending again with a fresh count';

    -- the secret
    DELETE FROM public.internal_settings WHERE key = 'crawler_secret';
    ASSERT public.crawler_secret_ok('anything-at-all-anything-at-all') = FALSE, 'no stored secret never matches';
    INSERT INTO public.internal_settings (key, value) VALUES ('crawler_secret', 'short');
    ASSERT public.crawler_secret_ok('short') = FALSE, 'a short stored secret never matches';
    UPDATE public.internal_settings SET value = 'a-long-enough-secret-for-testing-114' WHERE key = 'crawler_secret';
    ASSERT public.crawler_secret_ok('a-long-enough-secret-for-testing-114') = TRUE, 'the right secret matches';
    ASSERT public.crawler_secret_ok('a-long-enough-secret-for-testing-115') = FALSE, 'a wrong secret does not';
    ASSERT public.crawler_secret_ok(NULL) = FALSE, 'no secret does not';

    RAISE EXCEPTION 'rollback_test_114';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_114' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 114 TESTS PASSED';
END $$;

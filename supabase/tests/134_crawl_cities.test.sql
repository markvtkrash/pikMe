-- Test for migration 134: city imports. Wiring and access come from the catalog; the behaviour is tried inside a transaction that
-- is rolled back, so nothing is left behind. Needs migrations 114, 118 and 134. Success: no error.
DO $$
DECLARE
  v_admin   UUID;
  v_city    UUID;
  v_city2   UUID;
  v_claim   RECORD;
  v_res     JSONB;
  v_franch  TEXT;
  v_row     public.place_menu_crawl%ROWTYPE;
  v_a CONSTANT TEXT := 'ChIJcity134aaaaaaaaa';
  v_b CONSTANT TEXT := 'ChIJcity134bbbbbbbbb';
  v_c CONSTANT TEXT := 'ChIJcity134ccccccccc';
  v_d CONSTANT TEXT := 'ChIJcity134ddddddddd';
  v_e CONSTANT TEXT := 'ChIJcity134eeeeeeeee';
  v_f CONSTANT TEXT := 'ChIJcity134fffffffff';
  v_g CONSTANT TEXT := 'ChIJcity134ggggggggg';
BEGIN
  -- access: server only for the program's functions, signed-in (admin checked inside) for the page's
  ASSERT NOT has_function_privilege('anon', 'public.claim_crawl_city()', 'EXECUTE'), 'anon cannot claim a city';
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_crawl_city()', 'EXECUTE'), 'signed-in users cannot claim a city';
  ASSERT has_function_privilege('service_role', 'public.claim_crawl_city()', 'EXECUTE'), 'the server can claim a city';
  ASSERT NOT has_function_privilege('authenticated', 'public.record_city_discovery(uuid,jsonb,integer,integer,text,integer,text,text)', 'EXECUTE'), 'signed-in users cannot record results';
  ASSERT has_function_privilege('service_role', 'public.record_city_discovery(uuid,jsonb,integer,integer,text,integer,text,text)', 'EXECUTE'), 'the server can record results';
  ASSERT NOT has_function_privilege('authenticated', 'public.fail_crawl_city(uuid,text,integer)', 'EXECUTE'), 'signed-in users cannot report a failure';
  ASSERT NOT has_function_privilege('authenticated', 'public.crawl_city_call_limit()', 'EXECUTE'), 'signed-in users cannot read the call limit through the function';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_crawl_cities()', 'EXECUTE'), 'anon cannot list cities';
  ASSERT NOT has_function_privilege('anon', 'public.admin_save_crawl_city(uuid,text,text,integer,boolean)', 'EXECUTE'), 'anon cannot save a city';
  ASSERT has_function_privilege('authenticated', 'public.admin_save_crawl_city(uuid,text,text,integer,boolean)', 'EXECUTE'), 'the page can call save (admin is checked inside)';
  ASSERT NOT has_table_privilege('authenticated', 'public.crawl_cities', 'SELECT'), 'the table is not readable by signed-in users';
  ASSERT NOT has_table_privilege('anon', 'public.city_places', 'SELECT'), 'nor the list of found restaurants by anon';
  ASSERT has_table_privilege('service_role', 'public.crawl_cities', 'UPDATE'), 'the edge function (service role) can update cities';
  ASSERT EXISTS (SELECT 1 FROM public.app_config c WHERE c.key = 'cityCrawlMaxCalls'), 'the request limit setting exists';

  BEGIN
    -- a city's link is a valid source, and a bad one is not
    INSERT INTO public.place_menu_crawl (place_id, restaurant_name, link, link_source)
    VALUES ('ChIJcity134source00', 'Source Check', 'https://example.com', 'city');
    BEGIN
      INSERT INTO public.place_menu_crawl (place_id, restaurant_name, link, link_source)
      VALUES ('ChIJcity134source01', 'Source Check 2', 'https://example.com', 'nobody');
      ASSERT FALSE, 'an unknown link source is refused';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    DELETE FROM public.place_menu_crawl WHERE place_id = 'ChIJcity134source00';

    -- a city waits to be claimed, and is handed out once
    INSERT INTO public.crawl_cities (name, region, max_restaurants) VALUES ('Testville', 'TX', 3) RETURNING id INTO v_city;
    SELECT * INTO v_claim FROM public.claim_crawl_city() WHERE job_id = v_city;
    ASSERT v_claim.job_name = 'Testville' AND v_claim.job_max = 3, 'the pending city is handed out';
    ASSERT (SELECT status FROM public.crawl_cities WHERE id = v_city) = 'discovering', 'and is marked discovering';
    ASSERT (SELECT COUNT(*) FROM public.claim_crawl_city() WHERE job_id = v_city) = 0, 'a claimed city is not handed out twice';
    UPDATE public.crawl_cities SET enabled = FALSE WHERE id = v_city;
    UPDATE public.crawl_cities SET status = 'pending' WHERE id = v_city;
    ASSERT (SELECT COUNT(*) FROM public.claim_crawl_city() WHERE job_id = v_city) = 0, 'a switched-off city is skipped';
    UPDATE public.crawl_cities SET enabled = TRUE, status = 'discovering' WHERE id = v_city;

    -- an owner's link already in the queue is never replaced
    INSERT INTO public.place_menu_crawl (place_id, restaurant_name, link, link_source)
    VALUES (v_b, 'Owner Bistro', 'https://owner.example.com/menu', 'owner');

    SELECT fc.name INTO v_franch FROM public.franchise_chains fc WHERE fc.is_active LIMIT 1;

    -- first batch: queued, a duplicate, no website, not open, an owner-managed place, and (if there is one) a franchise
    v_res := public.record_city_discovery(
      v_city,
      jsonb_build_array(
        jsonb_build_object('place_id', v_a, 'name', 'Alpha Cafe', 'address', '1 Main St, Testville, TX', 'website', 'https://alpha.example.com', 'is_open', TRUE),
        jsonb_build_object('place_id', v_a, 'name', 'Alpha Cafe', 'address', '1 Main St, Testville, TX', 'website', 'https://alpha.example.com', 'is_open', TRUE),
        jsonb_build_object('place_id', v_b, 'name', 'Owner Bistro', 'address', '2 Main St, Testville, TX', 'website', 'https://bistro.example.com', 'is_open', TRUE),
        jsonb_build_object('place_id', v_c, 'name', 'No Site Diner', 'address', '3 Main St, Testville, TX', 'website', NULL, 'is_open', TRUE),
        jsonb_build_object('place_id', v_d, 'name', 'Closed Kitchen', 'address', '4 Main St, Testville, TX', 'website', 'https://closed.example.com', 'is_open', FALSE),
        jsonb_build_object('place_id', 'short', 'name', 'Bad Id', 'website', 'https://bad.example.com', 'is_open', TRUE)
      ) || CASE WHEN v_franch IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
        jsonb_build_object('place_id', v_e, 'name', v_franch, 'address', '5 Main St, Testville, TX', 'website', 'https://chain.example.com', 'is_open', TRUE)) END,
      4, 0, 'token-1', 0, NULL, NULL);
    ASSERT (v_res->>'finished')::BOOLEAN = FALSE, 'the search is not finished yet';
    ASSERT (v_res->>'counted')::INTEGER = 2, 'two restaurants count (Alpha Cafe, and the owner-managed one)';
    ASSERT (SELECT COUNT(*) FROM public.city_places WHERE city_id = v_city AND place_id = v_a) = 1, 'a duplicate is listed once';
    ASSERT (SELECT outcome FROM public.city_places WHERE city_id = v_city AND place_id = v_c) = 'no_website', 'no website is recorded';
    ASSERT (SELECT outcome FROM public.city_places WHERE city_id = v_city AND place_id = v_d) = 'not_open', 'a closed place is recorded';
    ASSERT NOT EXISTS (SELECT 1 FROM public.city_places WHERE city_id = v_city AND place_id = 'short'), 'a bad place id is dropped';
    IF v_franch IS NOT NULL THEN
      ASSERT (SELECT outcome FROM public.city_places WHERE city_id = v_city AND place_id = v_e) = 'franchise', 'a franchise is recorded and not queued';
      ASSERT NOT EXISTS (SELECT 1 FROM public.place_menu_crawl WHERE place_id = v_e), 'a franchise is not queued for the crawler';
    END IF;
    SELECT * INTO v_row FROM public.place_menu_crawl WHERE place_id = v_a;
    ASSERT v_row.link_source = 'city' AND v_row.link = 'https://alpha.example.com' AND v_row.status = 'pending', 'the website is queued as a city link';
    SELECT * INTO v_row FROM public.place_menu_crawl WHERE place_id = v_b;
    ASSERT v_row.link_source = 'owner' AND v_row.link = 'https://owner.example.com/menu', 'an owner link is never replaced by a city link';
    ASSERT NOT EXISTS (SELECT 1 FROM public.place_menu_crawl WHERE place_id IN (v_c, v_d)), 'no website and closed places are not queued';
    SELECT * INTO v_claim FROM public.crawl_cities WHERE id = v_city;
    ASSERT v_claim.status = 'discovering' AND v_claim.query_index = 0 AND v_claim.page_token = 'token-1', 'the search position is saved';
    ASSERT v_claim.google_calls = 4 AND v_claim.google_calls_last_run = 4, 'the requests are counted';

    -- second batch reaches the target (3): stop, remember where that page was read, and count the requests
    v_res := public.record_city_discovery(
      v_city,
      jsonb_build_array(
        jsonb_build_object('place_id', v_f, 'name', 'Foxtrot Grill', 'website', 'https://foxtrot.example.com', 'is_open', TRUE),
        jsonb_build_object('place_id', v_g, 'name', 'Golf Pizza', 'website', 'https://golf.example.com', 'is_open', TRUE)),
      2, 1, NULL, 0, 'token-1', NULL);
    ASSERT (v_res->>'finished')::BOOLEAN AND v_res->>'stop_reason' = 'reached_target', 'reaching the target finishes the search';
    ASSERT (v_res->>'counted')::INTEGER = 3, 'it stopped at three';
    ASSERT NOT EXISTS (SELECT 1 FROM public.city_places WHERE city_id = v_city AND place_id = v_g), 'places beyond the target are not taken';
    SELECT * INTO v_claim FROM public.crawl_cities WHERE id = v_city;
    ASSERT v_claim.status = 'crawling' AND v_claim.stop_reason = 'reached_target', 'the city is crawling (restaurants are waiting to be read)';
    ASSERT v_claim.query_index = 0 AND v_claim.page_token = 'token-1', 'it will resume from the page it stopped in';
    ASSERT v_claim.google_calls = 6 AND v_claim.google_calls_last_run = 6, 'the requests add up';

    -- a city's backlog never makes an owner's link wait
    UPDATE public.place_menu_crawl SET status = 'done' WHERE place_id NOT IN (v_a, v_b, v_f);   -- isolate (rolled back)
    UPDATE public.place_menu_crawl SET requested_at = NOW() + INTERVAL '1 hour' WHERE place_id = v_b;   -- the owner's is the newest
    UPDATE public.app_config SET value = '50' WHERE key = 'menuCrawlMaxPerRun';
    ASSERT (SELECT job_place_id FROM public.claim_place_crawls(1) LIMIT 1) = v_b, 'the owner link is handed out before the older city links';
    ASSERT (SELECT COUNT(*) FROM public.claim_place_crawls(5) WHERE job_place_id IN (v_a, v_f)) = 2, 'then the city links';

    -- the city is done once its restaurants have been read
    PERFORM public.sync_crawl_city_statuses();
    ASSERT (SELECT status FROM public.crawl_cities WHERE id = v_city) = 'crawling', 'not done while restaurants are still being read';
    UPDATE public.place_menu_crawl SET status = 'done' WHERE place_id IN (v_a, v_b, v_f);
    ASSERT public.sync_crawl_city_statuses() >= 1, 'a city whose restaurants have all been read is done';
    ASSERT (SELECT status FROM public.crawl_cities WHERE id = v_city) = 'done', 'and is marked done';

    -- a failed search is retried, then flagged
    INSERT INTO public.crawl_cities (name, region, max_restaurants, status, attempts) VALUES ('Failtown', '', 10, 'discovering', 1) RETURNING id INTO v_city2;
    ASSERT public.fail_crawl_city(v_city2, 'Google said no', 3) = 'error', 'a first failure is an error to retry';
    ASSERT (SELECT google_calls FROM public.crawl_cities WHERE id = v_city2) = 3, 'the failed requests are counted too';
    ASSERT (SELECT next_attempt_at FROM public.crawl_cities WHERE id = v_city2) > NOW() + INTERVAL '5 hours', 'retried after about 6 hours';
    UPDATE public.crawl_cities SET attempts = 3 WHERE id = v_city2;
    ASSERT public.fail_crawl_city(v_city2, 'still no', 0) = 'needs_attention', 'repeated failures need attention';

    -- running out of results finishes with nothing waiting
    INSERT INTO public.crawl_cities (name, region, max_restaurants, status) VALUES ('Emptyville', '', 10, 'discovering') RETURNING id INTO v_city2;
    v_res := public.record_city_discovery(v_city2, '[]'::jsonb, 5, 31, NULL, 30, NULL, 'ran_out_of_results');
    ASSERT (v_res->>'finished')::BOOLEAN AND v_res->>'status' = 'done', 'a city with nothing queued is done';
    ASSERT (SELECT stop_reason FROM public.crawl_cities WHERE id = v_city2) = 'ran_out_of_results', 'and says why it stopped';

    -- the admin page
    SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
    IF v_admin IS NULL THEN
      RAISE NOTICE 'no admin user to try the page functions with; server-side checks only';
    ELSE
      PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
      DELETE FROM public.crawl_cities WHERE id IN (v_city, v_city2);

      BEGIN PERFORM public.admin_save_crawl_city(NULL, 'A', '', 10, TRUE); ASSERT FALSE, 'a one-letter name is refused';
      EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%refused%' THEN RAISE; END IF; END;
      BEGIN PERFORM public.admin_save_crawl_city(NULL, 'Austin', 'TX', 0, TRUE); ASSERT FALSE, 'zero restaurants is refused';
      EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%refused%' THEN RAISE; END IF; END;
      BEGIN PERFORM public.admin_save_crawl_city(NULL, 'Austin', 'TX', 1001, TRUE); ASSERT FALSE, 'over 1000 restaurants is refused';
      EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%refused%' THEN RAISE; END IF; END;

      v_city := public.admin_save_crawl_city(NULL, '  Austin ', ' TX ', 5, TRUE);
      ASSERT (SELECT name || '|' || region FROM public.crawl_cities WHERE id = v_city) = 'Austin|TX', 'the name and region are trimmed';
      BEGIN
        PERFORM public.admin_save_crawl_city(NULL, 'austin', 'tx', 5, TRUE);
        ASSERT FALSE, 'the same city twice is refused';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%already in the list%' THEN RAISE; END IF;
      END;
      ASSERT (SELECT status FROM public.crawl_cities WHERE id = v_city) = 'pending', 'a new city is pending';
      ASSERT EXISTS (SELECT 1 FROM public.admin_list_crawl_cities() WHERE id = v_city AND places_found = 0), 'it is listed';

      -- raising the number on a city that stopped at its target puts it back in line, from where it stopped
      UPDATE public.crawl_cities SET status = 'crawling', stop_reason = 'reached_target', query_index = 4, page_token = 'tok' WHERE id = v_city;
      PERFORM public.admin_save_crawl_city(v_city, 'Austin', 'TX', 10, TRUE);
      SELECT * INTO v_claim FROM public.crawl_cities WHERE id = v_city;
      ASSERT v_claim.status = 'pending' AND v_claim.query_index = 4 AND v_claim.page_token = 'tok' AND v_claim.stop_reason IS NULL,
        'a higher target resumes where the search stopped';

      -- running again after it ran out of results starts from the first search
      UPDATE public.crawl_cities SET status = 'done', stop_reason = 'ran_out_of_results', query_index = 31, page_token = NULL WHERE id = v_city;
      PERFORM public.admin_run_crawl_city_again(v_city);
      SELECT * INTO v_claim FROM public.crawl_cities WHERE id = v_city;
      ASSERT v_claim.status = 'pending' AND v_claim.query_index = 0, 'run again after running out starts from the first search';

      PERFORM public.admin_delete_crawl_city(v_city);
      ASSERT NOT EXISTS (SELECT 1 FROM public.crawl_cities WHERE id = v_city), 'a city can be deleted';

      -- anyone who is not an admin is refused
      PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
      BEGIN
        PERFORM public.admin_list_crawl_cities();
        ASSERT FALSE, 'a non-admin must be refused';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%Admin access required%' THEN RAISE; END IF;
      END;
    END IF;

    RAISE EXCEPTION 'rollback_test_134';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_134' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 134 TESTS PASSED';
END $$;

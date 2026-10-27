-- Test for migrations 163 and 164: the Google website is cached, and the menu agent uses it as its last-resort start URL.
-- Two self-contained blocks, each in a sub-block that is rolled back, so nothing is left behind.
-- Success: no error, and "ALL 164 TESTS PASSED" at the end.

-- ── Block 1 (migration 163): upsert_restaurants keeps the website ───────────
DO $$
DECLARE
  v_row JSONB := jsonb_build_object(
    'placeId', 'test164placeA01', 'name', 'Test A', 'latitude', 30.2, 'longitude', -97.7, 'address', '1 Test St',
    'city', 'Austin', 'rating', 4, 'priceLevel', NULL, 'cuisineTypes', '[]'::jsonb, 'photoReference', NULL,
    'openingHours', NULL, 'openNow', TRUE);
BEGIN
  BEGIN
    -- a website is stored, trimmed
    PERFORM public.upsert_restaurants(jsonb_build_array(v_row || jsonb_build_object('website', '  https://a.example.com/  ')));
    ASSERT (SELECT website FROM public.cached_restaurants WHERE place_id = 'test164placeA01') = 'https://a.example.com/',
      'the website is stored, trimmed';

    -- a later save with no website (owner claim, relocation, older callers) keeps it
    PERFORM public.upsert_restaurants(jsonb_build_array(v_row));
    ASSERT (SELECT website FROM public.cached_restaurants WHERE place_id = 'test164placeA01') = 'https://a.example.com/',
      'a save without a website keeps the stored one';

    -- a blank or null website does not wipe it either
    PERFORM public.upsert_restaurants(jsonb_build_array(v_row || jsonb_build_object('website', '   ')));
    ASSERT (SELECT website FROM public.cached_restaurants WHERE place_id = 'test164placeA01') = 'https://a.example.com/',
      'a blank website keeps the stored one';
    PERFORM public.upsert_restaurants(jsonb_build_array(v_row || jsonb_build_object('website', NULL)));
    ASSERT (SELECT website FROM public.cached_restaurants WHERE place_id = 'test164placeA01') = 'https://a.example.com/',
      'a null website keeps the stored one';

    -- a new website replaces the old one
    PERFORM public.upsert_restaurants(jsonb_build_array(v_row || jsonb_build_object('website', 'https://b.example.com')));
    ASSERT (SELECT website FROM public.cached_restaurants WHERE place_id = 'test164placeA01') = 'https://b.example.com',
      'a new website replaces the old one';

    -- a first save with no website leaves it empty
    PERFORM public.upsert_restaurants(jsonb_build_array(
      (v_row || jsonb_build_object('placeId', 'test164placeA02', 'name', 'Test A2'))));
    ASSERT (SELECT website FROM public.cached_restaurants WHERE place_id = 'test164placeA02') IS NULL,
      'no website given: stays empty';

    -- an over-long website is cut to 2000 characters
    PERFORM public.upsert_restaurants(jsonb_build_array(
      (v_row || jsonb_build_object('placeId', 'test164placeA03', 'name', 'Test A3', 'website', 'https://c.example.com/' || repeat('x', 3000)))));
    ASSERT length((SELECT website FROM public.cached_restaurants WHERE place_id = 'test164placeA03')) = 2000,
      'an over-long website is cut to 2000 characters';

    RAISE EXCEPTION 'rollback_test_164';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_164' THEN RAISE; END IF;
  END;
END $$;


-- ── Block 2 (migration 164): the cached website is the agent's last start URL ─
DO $$
DECLARE
  v_res TEXT;
  v_url TEXT;
BEGIN
  BEGIN
    UPDATE public.app_config SET value = 'true' WHERE key = 'menuAgentEnabled';
    UPDATE public.app_config SET value = '' WHERE key IN ('menuAgentDailyTokenCap', 'menuAgentDailyJobCap');
    DELETE FROM public.menu_agent_jobs WHERE place_id LIKE 'test164%';

    PERFORM public.upsert_restaurants(jsonb_build_array(jsonb_build_object(
      'placeId', 'test164placeB01', 'name', 'Test Grill B', 'latitude', 30.2, 'longitude', -97.7, 'address', '1 Test St',
      'city', 'Austin', 'rating', 4, 'priceLevel', NULL, 'cuisineTypes', '[]'::jsonb, 'photoReference', NULL,
      'openingHours', NULL, 'openNow', TRUE, 'website', 'https://grill-b.example.com')));

    -- the cached website alone is enough to queue
    v_res := public.request_menu_agent_for_place('test164placeB01', 'Test Grill B');
    ASSERT v_res = 'queued', 'a cached website queues the restaurant, got ' || v_res;
    SELECT start_url INTO v_url FROM public.menu_agent_jobs WHERE place_id = 'test164placeB01';
    ASSERT v_url = 'https://grill-b.example.com', 'the job starts at the cached website, got ' || COALESCE(v_url, 'NULL');

    -- no website at all: still no_url
    PERFORM public.upsert_restaurants(jsonb_build_array(jsonb_build_object(
      'placeId', 'test164placeB02', 'name', 'Test Grill C', 'latitude', 30.2, 'longitude', -97.7, 'address', '2 Test St',
      'city', 'Austin', 'rating', 4, 'priceLevel', NULL, 'cuisineTypes', '[]'::jsonb, 'photoReference', NULL,
      'openingHours', NULL, 'openNow', TRUE)));
    v_res := public.request_menu_agent_for_place('test164placeB02', 'Test Grill C');
    ASSERT v_res = 'no_url', 'no website anywhere is still no_url, got ' || v_res;

    -- a website that is not a web address is ignored
    UPDATE public.cached_restaurants SET website = 'not a url' WHERE place_id = 'test164placeB02';
    v_res := public.request_menu_agent_for_place('test164placeB02', 'Test Grill C');
    ASSERT v_res = 'no_url', 'a website that is not an http(s) address is ignored, got ' || v_res;

    -- the switch is still honoured
    UPDATE public.app_config SET value = 'false' WHERE key = 'menuAgentEnabled';
    UPDATE public.cached_restaurants SET website = 'https://grill-c.example.com' WHERE place_id = 'test164placeB02';
    v_res := public.request_menu_agent_for_place('test164placeB02', 'Test Grill C');
    ASSERT v_res = 'disabled', 'switched off: disabled, got ' || v_res;
    UPDATE public.app_config SET value = 'true' WHERE key = 'menuAgentEnabled';

    -- a recently tried restaurant is still not queued again
    v_res := public.request_menu_agent_for_place('test164placeB01', 'Test Grill B');
    ASSERT v_res IN ('recently_tried', 'already_open'), 'asking again is not queued twice, got ' || v_res;

    RAISE EXCEPTION 'rollback_test_164';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_164' THEN RAISE; END IF;
  END;
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL 164 TESTS PASSED'; END $$;

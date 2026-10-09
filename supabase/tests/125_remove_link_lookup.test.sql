-- Test for migration 125: no outside lookup finds a menu link for an independent restaurant. Wiring is checked from the catalog;
-- the behaviour is tried on one real cached restaurant inside a transaction that is rolled back. Needs migrations 114, 118,
-- 119 and 125. Success: no error.
DO $$
DECLARE
  v_place TEXT;
  v_name  TEXT;
  v_res   TEXT;
  v_link  TEXT := 'https://menu-test-125.example.com/menu';
BEGIN
  -- the lookup is gone
  ASSERT to_regclass('public.place_menu_discovery') IS NULL, 'the lookup table is dropped';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('claim_place_discoveries', 'finish_place_discovery', 'discovery_run_limit')
  ), 'the lookup functions are dropped';
  ASSERT NOT EXISTS (SELECT 1 FROM public.app_config WHERE key IN ('menuDiscoveriesPerRun', 'menuClickRequestsPerDay')), 'the lookup settings are gone';
  ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'menuClickRetryDays'), 'the retry days setting stays';

  -- what remains is still server-only / admin-only
  ASSERT has_function_privilege('service_role', 'public.request_place_menu_import(text,text)', 'EXECUTE'), 'the server can request';
  ASSERT NOT has_function_privilege('anon', 'public.request_place_menu_import(text,text)', 'EXECUTE'), 'anon cannot request';
  ASSERT has_function_privilege('authenticated', 'public.admin_list_unconfirmed_clicked_restaurants(integer,integer)', 'EXECUTE'), 'admins can list';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_unconfirmed_clicked_restaurants(integer,integer)', 'EXECUTE'), 'anon cannot list';

  -- invalid input
  ASSERT public.request_place_menu_import(NULL, 'x') = 'invalid', 'null place is invalid';
  ASSERT public.request_place_menu_import('ChIJ_does_not_exist_125', 'Some Cafe') = 'unknown_place', 'an unknown place is refused';

  SELECT cr.place_id, cr.name INTO v_place, v_name FROM public.cached_restaurants cr
  WHERE cr.place_id ~ '^[A-Za-z0-9_-]{10,200}$' AND NOT public.is_franchise_chain(cr.name)
  ORDER BY cr.cached_at DESC LIMIT 1;
  IF v_place IS NULL THEN
    RAISE NOTICE 'no cached independent restaurant to try the behaviour on; wiring checks only';
    RAISE NOTICE 'ALL 125 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    DELETE FROM public.place_menu_crawl WHERE place_id = v_place;
    UPDATE public.menu_build_queue SET override_link = NULL WHERE kind = 'place' AND place_id = v_place;
    DELETE FROM public.menu_items WHERE place_id = v_place AND item_id NOT LIKE 'ai\_%' ESCAPE '\';
    UPDATE public.restaurants SET menu_link = NULL WHERE google_place_id = v_place;
    UPDATE public.app_config SET value = '30' WHERE key = 'menuClickRetryDays';

    -- 1. no link known: nothing is queued, and nothing is looked up
    v_res := public.request_place_menu_import(v_place, v_name);
    ASSERT v_res = 'no_link', 'a click with no link gives no_link, got ' || v_res;
    ASSERT NOT EXISTS (SELECT 1 FROM public.place_menu_crawl WHERE place_id = v_place), 'nothing is queued for the crawler';
    ASSERT public.enqueue_menu_build(v_place, v_name) = 'no_link', 'the customer click gives the same answer';

    -- 2. the click is recorded for the admin (migration 119), and the list shows it as having no link yet
    ASSERT EXISTS (SELECT 1 FROM public.place_menu_clicks WHERE place_id = v_place), 'the click is recorded for the admin';

    -- 3. a link the restaurant already has (the owner's) is queued
    UPDATE public.restaurants SET menu_link = v_link WHERE google_place_id = v_place;
    DELETE FROM public.place_menu_crawl WHERE place_id = v_place;
    v_res := public.request_place_menu_import(v_place, v_name);
    IF EXISTS (SELECT 1 FROM public.restaurants WHERE google_place_id = v_place) THEN
      ASSERT v_res = 'queued', 'an owner link is queued by a click, got ' || v_res;
      ASSERT (SELECT link_source FROM public.place_menu_crawl WHERE place_id = v_place) = 'owner', 'as the owner link';
      ASSERT public.request_place_menu_import(v_place, v_name) = 'already_queued', 'and not queued twice';
    END IF;

    -- 4. an admin link is queued too
    DELETE FROM public.place_menu_crawl WHERE place_id = v_place;
    UPDATE public.restaurants SET menu_link = NULL WHERE google_place_id = v_place;
    INSERT INTO public.menu_build_queue (kind, place_id, restaurant_name, status, override_link)
    VALUES ('place', v_place, v_name, 'built', NULL)
    ON CONFLICT (place_id) WHERE kind = 'place' DO NOTHING;
    UPDATE public.menu_build_queue SET override_link = v_link WHERE kind = 'place' AND place_id = v_place;   -- (the trigger queues the crawl)
    ASSERT (SELECT link_source FROM public.place_menu_crawl WHERE place_id = v_place) = 'admin', 'an admin link is queued for the crawler';

    -- 5. a restaurant that already has real items is not queued
    DELETE FROM public.place_menu_crawl WHERE place_id = v_place;
    INSERT INTO public.menu_items (
      item_id, restaurant_name, name, calories, protein_g, total_carbs_g, total_fat_g, saturated_fat_g, sodium_mg,
      is_verified, cached_at, place_id
    ) VALUES ('manual_test125_' || md5(v_place), v_name, 'Test125 Item', 100, 0, 0, 0, 0, 0, true, NOW(), v_place);
    ASSERT public.request_place_menu_import(v_place, v_name) = 'already_built', 'a real menu is already built';

    RAISE EXCEPTION 'rollback_test_125';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_125' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 125 TESTS PASSED';
END $$;

-- Test for migration 146: menu_status_for_places. Everything is tried inside a transaction that is rolled back. Needs migrations 100, 103, 139, 140
-- and 146. Success: no error.
DO $$
DECLARE
  v_conf  CONSTANT TEXT := 'ChIJms146confirmed1';
  v_est   CONSTANT TEXT := 'ChIJms146estimated1';
  v_none  CONSTANT TEXT := 'ChIJms146nothing001';
  v_oos   CONSTANT TEXT := 'ChIJms146soldout001';
  v_chain CONSTANT TEXT := 'ChIJms146franchise1';
  v_hid   CONSTANT TEXT := 'ChIJms146hidden0001';
  v_stat  TEXT;
  v_n     INTEGER;
BEGIN
  ASSERT has_function_privilege('service_role', 'public.menu_status_for_places(text[], text[])', 'EXECUTE'), 'the edge function (service role) can ask';
  ASSERT has_function_privilege('authenticated', 'public.menu_status_for_places(text[], text[])', 'EXECUTE'), 'a signed-in customer can ask';

  BEGIN
    UPDATE public.app_config SET value = 'false' WHERE key = 'enforceListingEligibility';

    INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, is_out_of_stock, place_id) VALUES
      ('t146-c1', 'Confirmed Cafe146', 'Soup',  TRUE,  FALSE, v_conf),
      ('t146-c2', 'Confirmed Cafe146', 'Salad', FALSE, FALSE, v_conf),   -- one confirmed among estimates is enough
      ('t146-e1', 'Estimate Cafe146',  'Stew',  FALSE, FALSE, v_est),
      ('t146-e2', 'Estimate Cafe146',  'Pie',   FALSE, FALSE, v_est),
      ('t146-o1', 'Soldout Cafe146',   'Cake',  TRUE,  TRUE,  v_oos),    -- the only item is sold out
      ('t146-h1', 'Hidden Cafe146',    'Tea',   TRUE,  FALSE, v_hid);

    -- a franchise with a shared chain menu (no place of its own)
    INSERT INTO public.franchise_chains (name, normalized_name, category, aliases) VALUES ('ZZ Status Chain146', 'x', 'Test', ARRAY[]::TEXT[]);
    INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, is_out_of_stock, place_id) VALUES
      ('t146-f1', 'ZZ Status Chain146', 'Burger', FALSE, FALSE, NULL);

    -- ── the three answers ──
    SELECT status INTO v_stat FROM public.menu_status_for_places(ARRAY[v_conf], ARRAY['Confirmed Cafe146']);
    ASSERT v_stat = 'confirmed', 'a menu with a confirmed item is confirmed, got ' || COALESCE(v_stat, 'null');

    SELECT status INTO v_stat FROM public.menu_status_for_places(ARRAY[v_est], ARRAY['Estimate Cafe146']);
    ASSERT v_stat = 'estimated', 'a menu with only unconfirmed items is estimated, got ' || COALESCE(v_stat, 'null');

    SELECT status INTO v_stat FROM public.menu_status_for_places(ARRAY[v_none], ARRAY['Nothing Cafe146']);
    ASSERT v_stat = 'none', 'a place with no items is none, got ' || COALESCE(v_stat, 'null');

    SELECT status INTO v_stat FROM public.menu_status_for_places(ARRAY[v_oos], ARRAY['Soldout Cafe146']);
    ASSERT v_stat = 'none', 'a sold-out item does not count (the page does not show it), got ' || COALESCE(v_stat, 'null');

    -- a franchise falls back to the shared chain menu, which is unconfirmed
    SELECT status INTO v_stat FROM public.menu_status_for_places(ARRAY[v_chain], ARRAY['ZZ Status Chain146']);
    ASSERT v_stat = 'estimated', 'a franchise with a shared menu is estimated, got ' || COALESCE(v_stat, 'null');

    -- ── many at once, in any order, one row per place ──
    SELECT COUNT(*) INTO v_n FROM public.menu_status_for_places(
      ARRAY[v_conf, v_est, v_none, v_conf], ARRAY['Confirmed Cafe146', 'Estimate Cafe146', 'Nothing Cafe146', 'Confirmed Cafe146']);
    ASSERT v_n = 3, 'a place given twice is answered once, got ' || v_n;
    ASSERT (SELECT status FROM public.menu_status_for_places(ARRAY[v_est, v_conf], ARRAY['Estimate Cafe146', 'Confirmed Cafe146']) WHERE place_id = v_conf) = 'confirmed',
      'each answer belongs to its own place whatever the order';

    -- ── edges ──
    SELECT COUNT(*) INTO v_n FROM public.menu_status_for_places(ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
    ASSERT v_n = 0, 'an empty list gives nothing';
    SELECT COUNT(*) INTO v_n FROM public.menu_status_for_places(ARRAY[NULL]::TEXT[], ARRAY['X']);
    ASSERT v_n = 0, 'a missing place ID is skipped';

    -- ── a place that is not listed has no menu, so the badge never promises one ──
    INSERT INTO public.restaurant_listing (google_place_id, is_eligible, reason) VALUES (v_hid, FALSE, 'test');
    SELECT status INTO v_stat FROM public.menu_status_for_places(ARRAY[v_hid], ARRAY['Hidden Cafe146']);
    ASSERT v_stat = 'confirmed', 'with the listing switch off the flag is ignored, got ' || COALESCE(v_stat, 'null');
    UPDATE public.app_config SET value = 'true' WHERE key = 'enforceListingEligibility';
    SELECT status INTO v_stat FROM public.menu_status_for_places(ARRAY[v_hid], ARRAY['Hidden Cafe146']);
    ASSERT v_stat = 'none', 'a place that is not listed has no menu, got ' || COALESCE(v_stat, 'null');

    RAISE EXCEPTION 'rollback-146';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback-146' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 146 TESTS PASSED';
END $$;

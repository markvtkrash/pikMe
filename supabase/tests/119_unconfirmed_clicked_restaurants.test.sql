-- Test for migration 119: restaurants opened with no confirmed menu item. Wiring and access come from the catalog; the
-- behaviour is tried on one real cached restaurant inside a transaction that is rolled back. Needs 114, 118 and 119.
-- Success: no error.
DO $$
DECLARE
  v_place TEXT;
  v_name  TEXT;
  v_count INTEGER;
BEGIN
  ASSERT has_function_privilege('authenticated', 'public.admin_list_unconfirmed_clicked_restaurants(integer,integer)', 'EXECUTE'), 'admins call it as signed-in users';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_unconfirmed_clicked_restaurants(integer,integer)', 'EXECUTE'), 'anon cannot';
  ASSERT NOT has_function_privilege('authenticated', 'public.record_unconfirmed_click(text,text)', 'EXECUTE'), 'users cannot record clicks';
  ASSERT has_function_privilege('service_role', 'public.record_unconfirmed_click(text,text)', 'EXECUTE'), 'the server can';
  ASSERT NOT has_table_privilege('anon', 'public.place_menu_clicks', 'SELECT'), 'anon cannot read the table';
  ASSERT NOT has_table_privilege('authenticated', 'public.place_menu_clicks', 'SELECT'), 'signed-in users cannot read the table';

  -- not an admin: refused
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    PERFORM * FROM public.admin_list_unconfirmed_clicked_restaurants(5, 0);
    RAISE EXCEPTION 'a non-admin was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'a non-admin was allowed' THEN RAISE; END IF;
  END;

  SELECT cr.place_id, cr.name INTO v_place, v_name FROM public.cached_restaurants cr
  WHERE cr.place_id ~ '^[A-Za-z0-9_-]{10,200}$' AND NOT public.is_franchise_chain(cr.name)
  ORDER BY cr.cached_at DESC LIMIT 1;
  IF v_place IS NULL THEN
    RAISE NOTICE 'no cached independent restaurant to try the behaviour on; wiring checks only';
    RAISE NOTICE 'ALL 119 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    DELETE FROM public.place_menu_clicks WHERE place_id = v_place;
    DELETE FROM public.menu_items WHERE place_id = v_place AND is_verified;

    -- a click on a restaurant with no confirmed item is recorded, and counted again on the next click
    PERFORM public.enqueue_menu_build(v_place, v_name);
    ASSERT (SELECT click_count FROM public.place_menu_clicks WHERE place_id = v_place) = 1, 'the first click is recorded';
    PERFORM public.enqueue_menu_build(v_place, v_name);
    ASSERT (SELECT click_count FROM public.place_menu_clicks WHERE place_id = v_place) = 2, 'the second click is counted';

    -- an AI guess alone is not a confirmed item: it is still recorded
    INSERT INTO public.menu_items (
      item_id, restaurant_name, name, calories, protein_g, total_carbs_g, total_fat_g, saturated_fat_g, sodium_mg,
      is_verified, cached_at, place_id
    ) VALUES ('ai_test119_' || md5(v_place), v_name, 'Test119 Guess', 100, 0, 0, 0, 0, 0, false, NOW(), v_place);
    PERFORM public.enqueue_menu_build(v_place, v_name);
    ASSERT (SELECT click_count FROM public.place_menu_clicks WHERE place_id = v_place) = 3, 'a click with only an AI guess is recorded';

    -- one confirmed item takes it off the list (and later clicks are not recorded)
    UPDATE public.menu_items SET is_verified = true WHERE item_id = 'ai_test119_' || md5(v_place);
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.place_menu_clicks k
      WHERE k.place_id = v_place AND NOT EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.place_id = k.place_id AND mi.is_verified)
    ), 'a confirmed item removes it from the list';
    PERFORM public.enqueue_menu_build(v_place, v_name);
    ASSERT (SELECT click_count FROM public.place_menu_clicks WHERE place_id = v_place) = 3, 'a click on a confirmed restaurant is not recorded';

    -- un-confirming the item puts it back on the list
    UPDATE public.menu_items SET is_verified = false WHERE item_id = 'ai_test119_' || md5(v_place);
    ASSERT EXISTS (
      SELECT 1 FROM public.place_menu_clicks k
      WHERE k.place_id = v_place AND NOT EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.place_id = k.place_id AND mi.is_verified)
    ), 'un-confirming brings it back';

    -- bad input never raises
    PERFORM public.record_unconfirmed_click(NULL, 'x');
    PERFORM public.record_unconfirmed_click(v_place, '   ');
    SELECT COUNT(*) INTO v_count FROM public.place_menu_clicks WHERE place_id IS NULL;
    ASSERT v_count = 0, 'nothing is recorded for bad input';

    RAISE EXCEPTION 'rollback_test_119';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_119' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 119 TESTS PASSED';
END $$;

-- Test for migration 103: an independent restaurant shows only items tied to its own place; builds replace a place's
-- pulled menu. Runs for real inside a transaction that is rolled back.
-- Requires migrations 062, 086, 100, 101, 102 and 103. Success: no error (Notices show PASS lines).
BEGIN;

INSERT INTO public.franchise_chains (name, aliases) VALUES ('ZZ Q6 Chain', ARRAY[]::text[]);
INSERT INTO public.cached_restaurants (place_id, name) VALUES
  ('ChIJzzq6placeXXXXXXXXXXX1', 'ZZ Q6 Cafe'),
  ('ChIJzzq6placeYYYYYYYYYYY2', 'ZZ Q6 Cafe'),
  ('ChIJzzq6placeZZZZZZZZZZZ3', 'ZZ Q6 Chain'),
  ('ChIJzzq6placeWWWWWWWWWWW4', 'ZZ Q6 Grill'),
  ('ChIJzzq6placeVVVVVVVVVVV5', 'ZZ Q6 Deli');

INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, place_id) VALUES
  ('chain_zzq6_1', 'ZZ Q6 Chain', 'Chain Taco', false, NULL),
  ('ai_zzq6_nameonly', 'ZZ Q6 Cafe', 'Name Only Guess', false, NULL),
  ('manual_zzq6_old', 'ZZ Q6 Cafe', 'Old Owner Dish', true, NULL);

CREATE FUNCTION pg_temp.shown(p_place TEXT, p_name TEXT) RETURNS TEXT[] AS $$
  SELECT COALESCE(array_agg(name ORDER BY name), '{}') FROM public.get_menu_items_for_restaurant(p_place, p_name)
$$ LANGUAGE sql;

DO $$
DECLARE
  x CONSTANT TEXT := 'ChIJzzq6placeXXXXXXXXXXX1';
  y CONSTANT TEXT := 'ChIJzzq6placeYYYYYYYYYYY2';
  z CONSTANT TEXT := 'ChIJzzq6placeZZZZZZZZZZZ3';
  w CONSTANT TEXT := 'ChIJzzq6placeWWWWWWWWWWW4';
  v CONSTANT TEXT := 'ChIJzzq6placeVVVVVVVVVVV5';
  n INTEGER;
BEGIN
  -- an independent shows nothing just because items share its name
  ASSERT pg_temp.shown(x, 'ZZ Q6 Cafe') = '{}', 'name-keyed items are not shown for an independent. Got ' || pg_temp.shown(x, 'ZZ Q6 Cafe')::text;
  ASSERT pg_temp.shown(NULL, 'ZZ Q6 Cafe') = '{}', 'and not without a place either';
  RAISE NOTICE 'PASS: no name-only matches for an independent';

  -- it shows its own place's items, and a same-name restaurant elsewhere does not
  n := public.upsert_place_menu_items(x, 'ZZ Q6 Cafe', jsonb_build_array(
    jsonb_build_object('itemId', 'manual_a1', 'name', 'House Burger', 'calories', 700, 'isVerified', true),
    jsonb_build_object('itemId', 'manual_a2', 'name', 'Side Salad',   'calories', 150, 'isVerified', true)));
  ASSERT pg_temp.shown(x, 'ZZ Q6 Cafe') = ARRAY['House Burger', 'Side Salad'], 'the place shows its own items';
  ASSERT pg_temp.shown(y, 'ZZ Q6 Cafe') = '{}', 'another restaurant with the same name shows nothing';
  RAISE NOTICE 'PASS: items belong to their own place';

  -- a franchise still shows the shared chain menu, from any of its stores
  ASSERT pg_temp.shown(z, 'ZZ Q6 Chain #9') = ARRAY['Chain Taco'], 'a franchise shows the chain menu';
  ASSERT pg_temp.shown(NULL, 'ZZ Q6 Chain') = ARRAY['Chain Taco'], 'with or without a place';
  RAISE NOTICE 'PASS: franchises keep the chain menu';

  -- the queue: AI guesses are not a built menu; a hand-entered or pulled item is
  PERFORM public.upsert_place_menu_items(w, 'ZZ Q6 Grill', jsonb_build_array(
    jsonb_build_object('itemId', 'ai_g1', 'name', 'Guess One', 'calories', 300, 'isVerified', false)));
  ASSERT public.enqueue_menu_build(w, 'ZZ Q6 Grill') = 'queued', 'a place with only AI guesses is still queued';
  ASSERT public.enqueue_menu_build(x, 'ZZ Q6 Cafe') = 'already_built', 'a place with hand-entered items is already built';
  RAISE NOTICE 'PASS: the queue ignores AI guesses';

  -- removing a place's pulled items and guesses keeps hand-entered ones
  PERFORM public.upsert_place_menu_items(v, 'ZZ Q6 Deli', jsonb_build_array(
    jsonb_build_object('itemId', 'manual_v1', 'name', 'Owner Dish',  'calories', 400, 'isVerified', true),
    jsonb_build_object('itemId', 'pull_v2',   'name', 'Pulled Dish', 'calories', 500, 'isVerified', true),
    jsonb_build_object('itemId', 'ai_v3',     'name', 'Guess Dish',  'calories', 600, 'isVerified', false)));
  ASSERT public.delete_place_pulled_items(v) = 2, 'the pulled item and the AI guess are removed, even the verified pulled one';
  ASSERT pg_temp.shown(v, 'ZZ Q6 Deli') = ARRAY['Owner Dish'], 'the hand-entered item stays';
  RAISE NOTICE 'PASS: pulled items go, hand-entered stay';

  -- a successful build replaces the pulled menu and adds only dishes not already there
  PERFORM public.upsert_place_menu_items(v, 'ZZ Q6 Deli', jsonb_build_array(
    jsonb_build_object('itemId', 'pull_v2', 'name', 'Old Pulled', 'calories', 500, 'isVerified', true)));
  n := public.replace_place_pulled_items(v, 'ZZ Q6 Deli', jsonb_build_array(
    jsonb_build_object('itemId', 'pull_n1', 'name', '  owner dish ', 'calories', 410, 'isVerified', true),
    jsonb_build_object('itemId', 'pull_n2', 'name', 'New Dish',     'calories', 520, 'isVerified', true)));
  ASSERT n = 1, 'only the dish not already on the menu is added. Got ' || n;
  ASSERT pg_temp.shown(v, 'ZZ Q6 Deli') = ARRAY['New Dish', 'Owner Dish'], 'the old pulled item is replaced, the owner dish is not duplicated';
  ASSERT (SELECT is_verified FROM public.menu_items WHERE place_id = v AND name = 'New Dish') = true, 'what the build adds is verified';
  RAISE NOTICE 'PASS: a build replaces the pulled menu and adds only new dishes';

  -- a failed save changes nothing
  BEGIN
    PERFORM public.replace_place_pulled_items(v, 'ZZ Q6 Deli', to_jsonb('not an array'::text));
    RAISE EXCEPTION 'a bad item list should have been refused';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  ASSERT pg_temp.shown(v, 'ZZ Q6 Deli') = ARRAY['New Dish', 'Owner Dish'], 'a failed swap leaves the menu as it was';
  RAISE NOTICE 'PASS: a failed swap changes nothing';

  -- access
  ASSERT has_function_privilege('anon', 'public.get_menu_items_for_restaurant(text,text)', 'EXECUTE'), 'customers can still look menus up';
  ASSERT NOT has_function_privilege('authenticated', 'public.delete_place_pulled_items(text)', 'EXECUTE'), 'signed-in users cannot clear pulled items';
  ASSERT NOT has_function_privilege('authenticated', 'public.replace_place_pulled_items(text,text,jsonb)', 'EXECUTE'), 'nor swap them';
  ASSERT has_function_privilege('service_role', 'public.delete_place_pulled_items(text)', 'EXECUTE'), 'the service role can';

  RAISE NOTICE 'ALL 103 TESTS PASSED';
END $$;

ROLLBACK;

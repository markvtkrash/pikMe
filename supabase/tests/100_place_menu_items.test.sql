-- Test for migration 100: place-aware menu saving. Runs the save and delete functions for real inside a
-- transaction that is rolled back. The four owner actions need a logged-in owner, so they are checked from
-- the function text. Success: no error (Notices show PASS lines).
-- Requires migrations 062, 067 and 100.
BEGIN;

INSERT INTO public.franchise_chains (name, aliases) VALUES ('ZZ Place Chain', ARRAY[]::text[]);

CREATE FUNCTION pg_temp.items(p_prefix TEXT) RETURNS JSONB AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('itemId', p_prefix || '_abc123', 'name', 'House Burger', 'calories', 700, 'isVerified', true),
    jsonb_build_object('itemId', p_prefix || '_def456', 'name', 'Side Salad',   'calories', 150, 'isVerified', false)
  )
$$ LANGUAGE sql;

DO $$
DECLARE
  place_a CONSTANT TEXT := 'ChIJzzplaceAAAAAAAAAAAAAA1';
  place_b CONSTANT TEXT := 'ChIJzzplaceBBBBBBBBBBBBBB2';
  n INTEGER;
BEGIN
  -- ids are unique per place and keep the source prefix
  ASSERT public.place_item_id(place_a, 'image_abc123') <> public.place_item_id(place_b, 'image_abc123'), 'the same dish gets a different id in each place';
  ASSERT public.place_item_id(place_a, 'image_abc123') = public.place_item_id(place_a, 'image_abc123'), 'the id is stable for one place';
  ASSERT public.place_item_id(place_a, 'image_abc123') LIKE 'image\_%' ESCAPE '\', 'the source prefix is kept';
  RAISE NOTICE 'PASS: item ids are unique per place';

  -- two places with the same name keep separate rows
  n := public.upsert_place_menu_items(place_a, 'ZZ Place Cafe', pg_temp.items('image'));
  ASSERT n = 2, 'two items saved for place A';
  n := public.upsert_place_menu_items(place_b, 'ZZ Place Cafe', pg_temp.items('image'));
  ASSERT n = 2, 'two items saved for place B';
  ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE place_id = place_a) = 2, 'place A has its own two rows';
  ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE place_id = place_b) = 2, 'place B has its own two rows';
  ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE restaurant_name = 'ZZ Place Cafe') = 4, 'four rows in all, none merged';
  ASSERT (SELECT is_verified FROM public.menu_items WHERE place_id = place_a AND name = 'House Burger') = true, 'the verified flag is kept';
  ASSERT (SELECT is_verified FROM public.menu_items WHERE place_id = place_a AND name = 'Side Salad') = false, 'unverified stays unverified';
  RAISE NOTICE 'PASS: same-name places keep separate rows';

  -- saving again updates in place, no duplicates
  n := public.upsert_place_menu_items(place_a, 'ZZ Place Cafe', pg_temp.items('image'));
  ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE place_id = place_a) = 2, 'a repeat save does not duplicate';
  RAISE NOTICE 'PASS: repeat saves do not duplicate';

  -- the customer lookup shows a place its own rows, and a place without any gets the shared name rows
  INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, place_id) VALUES
    ('ai_zz_shared_1', 'ZZ Place Cafe', 'Shared Guess', false, NULL);
  ASSERT (SELECT COUNT(*) FROM public.get_menu_items_for_restaurant(place_a, 'ZZ Place Cafe')) = 2, 'place A sees only its own two items';
  -- (Since migration 103 an independent with no items of its own shows nothing, not the shared name items.)
  ASSERT (SELECT COUNT(*) FROM public.get_menu_items_for_restaurant('ChIJzznoownrowsXXXXXXXXXX3', 'ZZ Place Cafe')) = 0, 'a place with none shows nothing by name alone';
  RAISE NOTICE 'PASS: the customer lookup uses the place''s own rows';

  -- deleting one place leaves the others and the shared rows alone
  n := public.delete_place_menu_items(place_a, true);
  ASSERT n = 1, 'only unverified rows go when asked: the Side Salad';
  ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE place_id = place_a) = 1, 'the verified item stays';
  n := public.delete_place_menu_items(place_a);
  ASSERT n = 1 AND (SELECT COUNT(*) FROM public.menu_items WHERE place_id = place_a) = 0, 'all of the place''s rows go';
  ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE place_id = place_b) = 2, 'the other place is untouched';
  ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'ai_zz_shared_1'), 'the shared name row is untouched';
  RAISE NOTICE 'PASS: deleting a place touches only that place';

  -- bad input is refused
  BEGIN
    PERFORM public.upsert_place_menu_items('short', 'ZZ Place Cafe', pg_temp.items('image'));
    RAISE EXCEPTION 'a bad place id should have been refused';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE '%valid Google place ID%', 'bad place id message. Got ' || SQLERRM;
  END;
  BEGIN
    PERFORM public.upsert_place_menu_items(place_a, '   ', pg_temp.items('image'));
    RAISE EXCEPTION 'a blank name should have been refused';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE '%restaurant name is required%', 'blank name message. Got ' || SQLERRM;
  END;
  ASSERT public.upsert_place_menu_items(place_a, 'ZZ Place Cafe', '[]'::jsonb) = 0, 'no items saves nothing';
  RAISE NOTICE 'PASS: bad input is refused';

  -- a franchise is never saved per place
  BEGIN
    PERFORM public.upsert_place_menu_items(place_a, 'ZZ Place Chain', pg_temp.items('image'));
    RAISE EXCEPTION 'a franchise should have been refused';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE '%franchise restaurant uses the shared chain menu%', 'franchise message. Got ' || SQLERRM;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.menu_items WHERE restaurant_name = 'ZZ Place Chain'), 'nothing was saved for the franchise';
  RAISE NOTICE 'PASS: a franchise is never saved per place';

  -- the owner actions find the owning restaurant by place for place items, by name otherwise
  ASSERT pg_get_functiondef('public.verify_menu_item(text,text)'::regprocedure) ILIKE '%google_place_id = v_place_id%', 'verify checks ownership by place';
  ASSERT pg_get_functiondef('public.unverify_menu_item(text)'::regprocedure) ILIKE '%google_place_id = v_place_id%', 'unverify checks ownership by place';
  ASSERT pg_get_functiondef('public.delete_menu_item(text,boolean)'::regprocedure) ILIKE '%google_place_id = v_place_id%', 'delete checks ownership by place';
  ASSERT pg_get_functiondef('public.set_menu_item_out_of_stock(text,boolean)'::regprocedure) ILIKE '%google_place_id = v_place_id%', 'out-of-stock checks ownership by place';
  ASSERT pg_get_functiondef('public.verify_menu_item(text,text)'::regprocedure) ILIKE '%lower(trim(name)) = lower(trim(v_restaurant_name))%', 'name-keyed items are still checked by name';
  ASSERT pg_get_functiondef('public.delete_menu_item(text,boolean)'::regprocedure) ILIKE '%is_franchise_chain%', 'the franchise refusal is still there';
  RAISE NOTICE 'PASS: owner actions check ownership by place';

  -- not callable from the apps
  ASSERT NOT has_function_privilege('authenticated', 'public.upsert_place_menu_items(text,text,jsonb)', 'EXECUTE'), 'signed-in users cannot save place menus directly';
  ASSERT NOT has_function_privilege('anon', 'public.upsert_place_menu_items(text,text,jsonb)', 'EXECUTE'), 'anon cannot';
  ASSERT NOT has_function_privilege('authenticated', 'public.delete_place_menu_items(text,boolean)', 'EXECUTE'), 'signed-in users cannot delete place menus directly';
  ASSERT has_function_privilege('service_role', 'public.upsert_place_menu_items(text,text,jsonb)', 'EXECUTE'), 'the service role can save';
  ASSERT has_function_privilege('service_role', 'public.delete_place_menu_items(text,boolean)', 'EXECUTE'), 'the service role can delete';
  ASSERT has_function_privilege('authenticated', 'public.verify_menu_item(text,text)', 'EXECUTE'), 'owners can still call verify';

  RAISE NOTICE 'ALL 100 TESTS PASSED';
END $$;

ROLLBACK;

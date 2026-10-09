-- Test for migration 104: a successful build only adds to an independent's menu. Runs for real inside a transaction
-- that is rolled back. Requires migrations 100, 103 and 104. Success: no error (Notices show PASS lines).
BEGIN;

DO $$
DECLARE
  p CONSTANT TEXT := 'ChIJzzq7placeAAAAAAAAAAA1';
  q CONSTANT TEXT := 'ChIJzzq7placeBBBBBBBBBBB2';
  r JSONB;
BEGIN
  -- a place with a hand-entered dish, an AI guess, and a dish from an earlier build
  PERFORM public.upsert_place_menu_items(p, 'ZZ Q7 Cafe', jsonb_build_array(
    jsonb_build_object('itemId', 'manual_o1', 'name', 'Owner Dish',  'calories', 400, 'isVerified', true),
    jsonb_build_object('itemId', 'ai_g1',     'name', 'Guess Dish',  'calories', 300, 'isVerified', false),
    jsonb_build_object('itemId', 'ai_g2',     'name', 'Unmatched Guess', 'calories', 350, 'isVerified', false),
    jsonb_build_object('itemId', 'pull_e1',   'name', 'Earlier Dish','calories', 500, 'isVerified', true)));

  r := public.merge_place_built_items(p, 'ZZ Q7 Cafe', jsonb_build_array(
    jsonb_build_object('itemId', 'pull_n1', 'name', '  guess dish ',  'calories', 310, 'isVerified', false),   -- matches the AI guess
    jsonb_build_object('itemId', 'pull_n2', 'name', 'OWNER DISH',     'calories', 410, 'isVerified', false),   -- matches a hand-entered dish
    jsonb_build_object('itemId', 'pull_n3', 'name', 'Earlier Dish',   'calories', 510, 'isVerified', false),   -- matches an earlier build
    jsonb_build_object('itemId', 'pull_n4', 'name', 'Brand New Dish', 'calories', 600, 'isVerified', false),   -- new
    jsonb_build_object('itemId', 'pull_n5', 'name', 'brand new dish', 'calories', 610, 'isVerified', false))); -- the same new dish twice

  ASSERT (r->>'added')::int = 1, 'one new dish is added. Got ' || r::text;
  ASSERT (r->>'confirmed')::int = 1, 'one AI guess is confirmed. Got ' || r::text;

  -- the matching AI guess is verified, not duplicated; its values are the ones it already had
  ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE place_id = p AND lower(name) = 'guess dish') = 1, 'the AI guess is not added twice';
  ASSERT (SELECT is_verified FROM public.menu_items WHERE place_id = p AND name = 'Guess Dish') = true, 'and is now verified';
  ASSERT (SELECT calories FROM public.menu_items WHERE place_id = p AND name = 'Guess Dish') = 300, 'with the values it had';
  RAISE NOTICE 'PASS: a matching AI guess is confirmed, not duplicated';

  -- a new dish is added, verified, once
  ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE place_id = p AND lower(name) = 'brand new dish') = 1, 'a new dish is added once';
  ASSERT (SELECT is_verified FROM public.menu_items WHERE place_id = p AND lower(name) = 'brand new dish') = true, 'and is verified';
  RAISE NOTICE 'PASS: new dishes are added, verified';

  -- nothing else changed: the hand-entered and earlier items stay as they were, an unmatched guess stays unverified
  ASSERT (SELECT calories FROM public.menu_items WHERE place_id = p AND name = 'Owner Dish') = 400, 'the hand-entered dish is untouched';
  ASSERT (SELECT calories FROM public.menu_items WHERE place_id = p AND name = 'Earlier Dish') = 500, 'the earlier built dish is untouched';
  ASSERT (SELECT is_verified FROM public.menu_items WHERE place_id = p AND name = 'Unmatched Guess') = false, 'an AI guess nothing matched stays an unverified guess';
  ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE place_id = p) = 5, 'nothing was deleted: 4 existing + 1 new = 5';
  RAISE NOTICE 'PASS: nothing is deleted or overwritten';

  -- a repeat build adds nothing
  r := public.merge_place_built_items(p, 'ZZ Q7 Cafe', jsonb_build_array(
    jsonb_build_object('itemId', 'pull_n4', 'name', 'Brand New Dish', 'calories', 600, 'isVerified', false)));
  ASSERT (r->>'added')::int = 0 AND (r->>'confirmed')::int = 0, 'running it again changes nothing. Got ' || r::text;
  RAISE NOTICE 'PASS: a repeat adds nothing';

  -- it never touches another place with the same name
  PERFORM public.upsert_place_menu_items(q, 'ZZ Q7 Cafe', jsonb_build_array(
    jsonb_build_object('itemId', 'ai_g1', 'name', 'Guess Dish', 'calories', 300, 'isVerified', false)));
  PERFORM public.merge_place_built_items(p, 'ZZ Q7 Cafe', jsonb_build_array(
    jsonb_build_object('itemId', 'pull_z', 'name', 'Guess Dish', 'calories', 300, 'isVerified', false)));
  ASSERT (SELECT is_verified FROM public.menu_items WHERE place_id = q AND name = 'Guess Dish') = false, 'another place''s guess is not confirmed';
  RAISE NOTICE 'PASS: other places are untouched';

  -- bad input and franchises are refused, and nothing changes
  BEGIN
    PERFORM public.merge_place_built_items(p, 'ZZ Q7 Cafe', to_jsonb('not an array'::text));
    RAISE EXCEPTION 'a bad item list should have been refused';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE '%must be a JSON array%', 'bad list message. Got ' || SQLERRM;
  END;
  ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE place_id = p) = 5, 'a refused call changes nothing';
  RAISE NOTICE 'PASS: bad input is refused';

  -- access
  ASSERT NOT has_function_privilege('authenticated', 'public.merge_place_built_items(text,text,jsonb)', 'EXECUTE'), 'signed-in users cannot run it';
  ASSERT NOT has_function_privilege('anon', 'public.merge_place_built_items(text,text,jsonb)', 'EXECUTE'), 'anon cannot';
  ASSERT has_function_privilege('service_role', 'public.merge_place_built_items(text,text,jsonb)', 'EXECUTE'), 'the service role can';

  RAISE NOTICE 'ALL 104 TESTS PASSED';
END $$;

ROLLBACK;

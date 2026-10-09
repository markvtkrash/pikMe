-- Test for migration 098: a chain build skips a dish whose name already exists as a verified item.
-- Self-contained; rolls back. Success: no error (Notices show PASS lines).
-- Requires migrations 067, 073 and 098.
BEGIN;

-- Fixture: a verified photo item, an old pulled item, a verified item of a single store's own menu.
INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, place_id) VALUES
  ('image_zz_skip_1', 'ZZ Skip Chain', 'Bean Burrito',  true,  NULL),
  ('chain_zz_skip_old', 'ZZ Skip Chain', 'Old Pulled Dish', false, NULL),
  ('image_zz_skip_loc', 'ZZ Skip Chain', 'Store Only Dish', true, 'zz_skip_place_1');

CREATE FUNCTION pg_temp.names() RETURNS TEXT[] AS $$
  SELECT COALESCE(array_agg(name || '|' || is_verified::text ORDER BY name, is_verified), '{}')
  FROM public.menu_items WHERE restaurant_name = 'ZZ Skip Chain' AND place_id IS NULL
$$ LANGUAGE sql;

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  v_count := public.replace_chain_menu_items('ZZ Skip Chain', jsonb_build_array(
    jsonb_build_object('itemId', 'chain_zz_skip_a', 'name', '  bean burrito ', 'calories', 350),
    jsonb_build_object('itemId', 'chain_zz_skip_b', 'name', 'Nachos Supreme',   'calories', 440),
    jsonb_build_object('itemId', 'chain_zz_skip_c', 'name', 'Store Only Dish',  'calories', 200)
  ));

  -- the verified photo item stays, its look-alike (other case and spaces) was not added; the new dishes were
  ASSERT pg_temp.names() = ARRAY['Bean Burrito|true', 'Nachos Supreme|false', 'Store Only Dish|false'],
    'verified wins, new dishes added, old pulled row replaced. Got ' || pg_temp.names()::text;
  RAISE NOTICE 'PASS: a dish already verified is not added again';

  -- the return value counts only what was written
  ASSERT v_count = 2, 'returns the number of dishes written, not the skipped one. Got ' || v_count;
  RAISE NOTICE 'PASS: the return value excludes skipped dishes';

  -- a single store's own verified menu does not hide a chain dish
  ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'chain_zz_skip_c'),
    'a dish that exists only on one store''s own menu is still added to the chain menu';
  ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'image_zz_skip_loc'), 'the store menu row is untouched';
  RAISE NOTICE 'PASS: per-location rows do not count';

  -- a second pull of the same dishes updates in place and still does not add the verified one
  v_count := public.replace_chain_menu_items('ZZ Skip Chain', jsonb_build_array(
    jsonb_build_object('itemId', 'chain_zz_skip_a', 'name', 'Bean Burrito',   'calories', 360),
    jsonb_build_object('itemId', 'chain_zz_skip_b', 'name', 'Nachos Supreme', 'calories', 450)
  ));
  ASSERT pg_temp.names() = ARRAY['Bean Burrito|true', 'Nachos Supreme|false'],
    'a second pull replaces the earlier pulled rows and still skips the verified dish. Got ' || pg_temp.names()::text;
  ASSERT v_count = 1, 'only the new dish counts on the second pull';
  RAISE NOTICE 'PASS: a repeat pull stays consistent';

  -- different chain name: no effect on other restaurants
  ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE restaurant_name = 'ZZ Other Chain') = 0, 'nothing leaks to another name';

  -- still service-role only
  ASSERT has_function_privilege('service_role', 'public.replace_chain_menu_items(text,jsonb)', 'EXECUTE'), 'service role can call it';
  ASSERT NOT has_function_privilege('anon', 'public.replace_chain_menu_items(text,jsonb)', 'EXECUTE'), 'anon cannot';
  ASSERT NOT has_function_privilege('authenticated', 'public.replace_chain_menu_items(text,jsonb)', 'EXECUTE'), 'signed-in users cannot';
  RAISE NOTICE 'ALL 098 TESTS PASSED';
END $$;

ROLLBACK;

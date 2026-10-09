-- Regression tests for migration 073: find_franchise_chain and
-- replace_chain_menu_items. Self-contained: creates its own chain, items and
-- saved-item fixtures inside a transaction and rolls back. Run after 062, 067
-- and 073 are applied. Runs as the database owner, so it checks function
-- logic, not role grants.
--
-- Success: "PASS: ..." notices and no error.

BEGIN;

DO $$
DECLARE
  v_chain   UUID;
  v_user    UUID;
  v_count   INTEGER;
  v_name    TEXT := 'ZZ Chain Menu Test';
BEGIN
  -- ── find_franchise_chain ────────────────────────────────────────────────────
  INSERT INTO public.franchise_chains (name, aliases) VALUES (v_name, ARRAY['ZZ Chainmenu Inc'])
  RETURNING id INTO v_chain;

  ASSERT (SELECT id FROM public.find_franchise_chain('ZZ Chain Menu Test')) = v_chain, 'matches by name';
  ASSERT (SELECT id FROM public.find_franchise_chain('zz chain menu test #42')) = v_chain, 'store number ignored';
  ASSERT (SELECT id FROM public.find_franchise_chain('ZZ Chainmenu Inc')) = v_chain, 'matches by alias';
  ASSERT (SELECT name FROM public.find_franchise_chain('ZZ Chainmenu Inc')) = v_name, 'returns the canonical chain name';
  ASSERT NOT EXISTS (SELECT 1 FROM public.find_franchise_chain('ZZ Chain Menu Test Cafe')), 'extra words do not match';
  ASSERT NOT EXISTS (SELECT 1 FROM public.find_franchise_chain('')), 'empty name';
  ASSERT NOT EXISTS (SELECT 1 FROM public.find_franchise_chain(NULL)), 'NULL name';
  ASSERT NOT EXISTS (SELECT 1 FROM public.find_franchise_chain('!!!')), 'punctuation only';
  ASSERT (SELECT COUNT(*) FROM public.find_franchise_chain('McDonald''s')) = 1, 'seeded chain found exactly once';

  UPDATE public.franchise_chains SET is_active = false WHERE id = v_chain;
  ASSERT NOT EXISTS (SELECT 1 FROM public.find_franchise_chain('ZZ Chain Menu Test')), 'inactive chain is not found';
  UPDATE public.franchise_chains SET is_active = true WHERE id = v_chain;
  RAISE NOTICE 'PASS: find_franchise_chain';

  -- ── replace_chain_menu_items ────────────────────────────────────────────────
  -- Fixtures: an old AI row (deletable), an old AI row a user saved (must stay),
  -- an old chain row, a verified owner row, a per-location row, another
  -- restaurant's AI row.
  INSERT INTO public.menu_items (item_id, restaurant_name, name, calories, is_verified, place_id) VALUES
    ('ai_zz_old',        v_name, 'Old AI Item',      100, false, NULL),
    ('ai_zz_saved',      v_name, 'Saved AI Item',    110, false, NULL),
    ('chain_zz_old',     v_name, 'Old Chain Item',   120, false, NULL),
    ('manual_zz_owner',  v_name, 'Owner Item',       130, true,  NULL),
    ('ai_zz_location',   v_name, 'Location Item',    140, false, 'ChIJzzlocation'),
    ('ai_zz_other',      'ZZ Other Restaurant', 'Other AI Item', 150, false, NULL);

  SELECT id INTO v_user FROM public.user_profiles LIMIT 1;
  IF v_user IS NOT NULL THEN
    INSERT INTO public.saved_menu_items (user_id, item_id) VALUES (v_user, 'ai_zz_saved');
  ELSE
    RAISE NOTICE 'SKIP: no user_profiles row, saved-item protection is not exercised';
  END IF;

  v_count := public.replace_chain_menu_items(v_name, jsonb_build_array(
    jsonb_build_object('itemId', 'chain_zz_new1', 'name', 'Crunchy Taco', 'calories', 170,
      'totalFat_g', 9, 'saturatedFat_g', 3.5, 'sodium_mg', 310, 'totalCarbs_g', 13,
      'dietaryFiber_g', 3, 'sugars_g', 1, 'protein_g', 8),
    jsonb_build_object('itemId', 'chain_zz_new2', 'name', 'Bean Burrito', 'calories', 350,
      'totalFat_g', 9, 'saturatedFat_g', 3, 'sodium_mg', 1000, 'totalCarbs_g', 55,
      'dietaryFiber_g', 13, 'sugars_g', 3, 'protein_g', 13)
  ));
  ASSERT v_count = 2, 'returns the number inserted';

  ASSERT NOT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'ai_zz_old'), 'old unsaved AI item removed';
  ASSERT NOT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'chain_zz_old'), 'old chain item removed';
  IF v_user IS NOT NULL THEN
    ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'ai_zz_saved'), 'AI item a user saved is kept';
    ASSERT EXISTS (SELECT 1 FROM public.saved_menu_items WHERE item_id = 'ai_zz_saved'), 'the user''s saved item is still saved';
  END IF;
  ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'manual_zz_owner'), 'verified owner item kept';
  ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'ai_zz_location'), 'per-location row kept';
  ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'ai_zz_other'), 'another restaurant is untouched';
  RAISE NOTICE 'PASS: replace removes only what it should';

  ASSERT (SELECT COUNT(*) FROM public.menu_items
          WHERE restaurant_name = v_name AND item_id LIKE 'chain\_zz\_new%' ESCAPE '\') = 2, 'new items inserted';
  ASSERT (SELECT is_verified FROM public.menu_items WHERE item_id = 'chain_zz_new1') = false, 'new items are unverified';
  ASSERT (SELECT place_id FROM public.menu_items WHERE item_id = 'chain_zz_new1') IS NULL, 'new items are the shared template';
  ASSERT (SELECT protein_g FROM public.menu_items WHERE item_id = 'chain_zz_new1') = 8, 'nutrition stored';
  ASSERT (SELECT dietary_fiber_g FROM public.menu_items WHERE item_id = 'chain_zz_new2') = 13, 'fiber stored';
  ASSERT (SELECT COUNT(*) FROM public.get_menu_items_for_restaurant(NULL, v_name)
          WHERE item_id IN ('chain_zz_new1', 'chain_zz_new2')) = 2, 'the app lookup returns the new items';
  RAISE NOTICE 'PASS: replace inserts the new items';

  -- Running it again with the same items replaces rather than duplicates.
  v_count := public.replace_chain_menu_items(v_name, jsonb_build_array(
    jsonb_build_object('itemId', 'chain_zz_new1', 'name', 'Crunchy Taco', 'calories', 175,
      'totalFat_g', 9, 'saturatedFat_g', 3.5, 'sodium_mg', 310, 'totalCarbs_g', 13,
      'dietaryFiber_g', 3, 'sugars_g', 1, 'protein_g', 8)
  ));
  ASSERT v_count = 1, 'second run inserts one';
  ASSERT (SELECT COUNT(*) FROM public.menu_items
          WHERE restaurant_name = v_name AND item_id LIKE 'chain\_zz\_new%' ESCAPE '\') = 1, 'refresh replaced, not piled up';
  ASSERT (SELECT calories FROM public.menu_items WHERE item_id = 'chain_zz_new1') = 175, 'refreshed value is used';
  RAISE NOTICE 'PASS: refresh replaces';

  -- Bad input is rejected.
  BEGIN
    PERFORM public.replace_chain_menu_items(v_name, '[]'::jsonb);
    ASSERT false, 'empty array should be rejected';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS: empty items rejected';
  END;
  BEGIN
    PERFORM public.replace_chain_menu_items('  ', jsonb_build_array(jsonb_build_object('itemId', 'x', 'name', 'x')));
    ASSERT false, 'blank chain name should be rejected';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS: blank chain name rejected';
  END;
  BEGIN
    PERFORM public.replace_chain_menu_items(v_name, '{"a":1}'::jsonb);
    ASSERT false, 'non-array should be rejected';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS: non-array rejected';
  END;
  -- A rejected call must not have deleted anything.
  ASSERT EXISTS (SELECT 1 FROM public.menu_items WHERE item_id = 'chain_zz_new1'), 'rejected call deleted nothing';

  RAISE NOTICE 'ALL 073 TESTS PASSED';
END $$;

ROLLBACK;

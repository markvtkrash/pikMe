-- Regression tests for migration 062: normalize_restaurant_name,
-- franchise_chains (trigger + uniqueness) and is_franchise_chain.
-- Self-contained: inserts its own test rows inside a transaction and rolls
-- back. Several cases use the seeded chains (McDonald's, Subway, Chick-fil-A,
-- Dunkin', Cheesecake Factory, Starbucks), so run it after 062 is applied.
--
-- Run in the Supabase SQL editor (or psql -f). Success: "PASS: ..." notices
-- and no error. A failed ASSERT aborts with the test name.

BEGIN;

DO $$
BEGIN
  -- ── normalize_restaurant_name ───────────────────────────────────────────────
  ASSERT public.normalize_restaurant_name('McDonald''s') = 'mcdonalds', 'apostrophe removed';
  ASSERT public.normalize_restaurant_name('McDonald’s') = 'mcdonalds', 'curly apostrophe removed';
  ASSERT public.normalize_restaurant_name('McDonald''s #4521') = 'mcdonalds', 'store number removed';
  ASSERT public.normalize_restaurant_name('McDonald''s # 12') = 'mcdonalds', 'store number with space removed';
  ASSERT public.normalize_restaurant_name('MCDONALD''S - Airport') = 'mcdonalds', 'location suffix removed + lowercased';
  ASSERT public.normalize_restaurant_name('Subway (Walmart)') = 'subway', 'parenthesised text removed';
  ASSERT public.normalize_restaurant_name('Chick-fil-A') = 'chick fil a', 'hyphens become spaces';
  ASSERT public.normalize_restaurant_name('A&W') = 'a and w', 'ampersand becomes and';
  ASSERT public.normalize_restaurant_name('  Subway  ') = 'subway', 'whitespace trimmed';
  ASSERT public.normalize_restaurant_name('Dunkin'' Donuts') = 'dunkin donuts', 'apostrophe + spaces';
  ASSERT public.normalize_restaurant_name(NULL) = '', 'NULL -> empty';
  ASSERT public.normalize_restaurant_name('') = '', 'empty -> empty';
  ASSERT public.normalize_restaurant_name('!!!') = '', 'punctuation only -> empty';
  -- A leading "The" is deliberately kept (see 062): chains use aliases for it.
  ASSERT public.normalize_restaurant_name('The Subway') = 'the subway', 'leading The is kept';
  -- A hyphen WITHOUT surrounding spaces is part of the name, not a suffix.
  ASSERT public.normalize_restaurant_name('Jack-in-the-Box') = 'jack in the box', 'inner hyphens are not a location suffix';
  RAISE NOTICE 'PASS: normalize_restaurant_name';

  -- ── is_franchise_chain: should MATCH ───────────────────────────────────────
  ASSERT public.is_franchise_chain('McDonald''s'), 'McDonald''s';
  ASSERT public.is_franchise_chain('McDonalds'), 'McDonalds (alias / normalized)';
  ASSERT public.is_franchise_chain('mcdonald''s #123'), 'store number';
  ASSERT public.is_franchise_chain('MCDONALD''S - Airport'), 'location suffix';
  ASSERT public.is_franchise_chain('Subway'), 'Subway';
  ASSERT public.is_franchise_chain('Subway (Walmart)'), 'parenthesised';
  ASSERT public.is_franchise_chain('Chick-fil-A'), 'Chick-fil-A';
  ASSERT public.is_franchise_chain('Chick fil A'), 'Chick fil A';
  ASSERT public.is_franchise_chain('Dunkin'' Donuts'), 'Dunkin'' Donuts alias';
  ASSERT public.is_franchise_chain('Starbucks Coffee'), 'alias: Starbucks Coffee';
  ASSERT public.is_franchise_chain('The Cheesecake Factory'), 'alias: The Cheesecake Factory';
  ASSERT public.is_franchise_chain('Cheesecake Factory'), 'Cheesecake Factory';
  RAISE NOTICE 'PASS: is_franchise_chain matches known chains and variants';

  -- ── is_franchise_chain: must NOT match (false-positive guard) ──────────────
  ASSERT NOT public.is_franchise_chain('Subway Tile Cafe'), 'prefix of a chain is not a match';
  ASSERT NOT public.is_franchise_chain('The Subway'), 'leading The is not stripped';
  ASSERT NOT public.is_franchise_chain('Burger King Palace'), 'chain name + extra words is not a match';
  ASSERT NOT public.is_franchise_chain('Joe''s Diner'), 'independent restaurant';
  ASSERT NOT public.is_franchise_chain('McDonald'), 'partial name is not a match';
  ASSERT NOT public.is_franchise_chain(''), 'empty string';
  ASSERT NOT public.is_franchise_chain(NULL), 'NULL';
  ASSERT NOT public.is_franchise_chain('!!!'), 'punctuation only';
  RAISE NOTICE 'PASS: is_franchise_chain rejects non-chains';
END $$;

-- ── Table behavior ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id UUID;
  v_norm TEXT;
BEGIN
  -- Trigger derives normalized_name on insert and ignores a hand-typed value.
  INSERT INTO public.franchise_chains (name, normalized_name, category, aliases)
  VALUES ('ZZ Test Chain''s #1', 'wrong value', 'Test', ARRAY['ZZ Testchain Inc'])
  RETURNING id, normalized_name INTO v_id, v_norm;
  ASSERT v_norm = 'zz test chains', 'trigger sets normalized_name on insert, got ' || v_norm;
  RAISE NOTICE 'PASS: trigger derives normalized_name on insert';

  -- Matches by name, by alias, and by decorated variants.
  ASSERT public.is_franchise_chain('ZZ Test Chain''s'), 'new chain matches by name';
  ASSERT public.is_franchise_chain('ZZ Test Chain''s #77 - Mall'), 'new chain matches with decorations';
  ASSERT public.is_franchise_chain('zz testchain inc'), 'new chain matches by alias';
  RAISE NOTICE 'PASS: new chain matches by name, alias and decorations';

  -- Renaming recalculates normalized_name.
  UPDATE public.franchise_chains SET name = 'ZZ Renamed Chain' WHERE id = v_id;
  SELECT normalized_name INTO v_norm FROM public.franchise_chains WHERE id = v_id;
  ASSERT v_norm = 'zz renamed chain', 'trigger recalculates on rename, got ' || v_norm;
  ASSERT NOT public.is_franchise_chain('ZZ Test Chain''s'), 'old name no longer matches after rename';
  ASSERT public.is_franchise_chain('ZZ Renamed Chain'), 'new name matches after rename';
  RAISE NOTICE 'PASS: rename recalculates the match key';

  -- Deactivating removes the match (name AND alias); reactivating restores it.
  UPDATE public.franchise_chains SET is_active = false WHERE id = v_id;
  ASSERT NOT public.is_franchise_chain('ZZ Renamed Chain'), 'inactive chain must not match by name';
  ASSERT NOT public.is_franchise_chain('ZZ Testchain Inc'), 'inactive chain must not match by alias';
  UPDATE public.franchise_chains SET is_active = true WHERE id = v_id;
  ASSERT public.is_franchise_chain('ZZ Renamed Chain'), 'reactivated chain matches again';
  RAISE NOTICE 'PASS: deactivate/reactivate toggles matching';

  -- Uniqueness is on the NORMALIZED name, so cosmetic duplicates are rejected.
  BEGIN
    INSERT INTO public.franchise_chains (name) VALUES ('zz renamed chain!!');
    ASSERT false, 'duplicate normalized name should have been rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate normalized name is rejected';
  END;

  -- Seed sanity: a sizeable list, and no generic one-word names that would
  -- falsely match independents.
  ASSERT (SELECT COUNT(*) FROM public.franchise_chains) >= 300, 'seed list should have 300+ chains';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.franchise_chains
    WHERE normalized_name IN ('slice','pizza','grill','cafe','diner','restaurant','kitchen','bar','food','mediterranean grill','pizza pro')
  ), 'seed must not contain generic names';
  RAISE NOTICE 'PASS: seed list sanity';

  RAISE NOTICE 'ALL 062 TESTS PASSED';
END $$;

ROLLBACK;

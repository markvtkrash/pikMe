-- Test for migration 086: get_menu_items_for_restaurant falls back to the chain's
-- menu. Self-contained; rolls back. Success: no error (open Notices for PASS lines).
-- Requires migrations 062, 067, 073 and 086.
BEGIN;

INSERT INTO public.franchise_chains (name, aliases, is_active)
VALUES ('ZZ Burger Chain', ARRAY['ZZ Burgers','ZZ Burger Co'], true),
       ('ZZ Off Chain', ARRAY['ZZ Off Alias'], false);

INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, is_out_of_stock, place_id) VALUES
  ('z_chain_1', 'ZZ Burger Chain', 'Chain Burger', false, false, NULL),
  ('z_chain_2', 'ZZ Burger Chain', 'Chain Fries',  false, false, NULL),
  ('z_chain_oos', 'ZZ Burger Chain', 'Chain Sold Out', false, true, NULL),
  ('z_own_1',   'ZZ Burger Chain', 'Own Special',  true,  false, 'zz_place_own'),
  ('z_exact_1', 'ZZ Burger Chain Cantina', 'Cantina Dish', false, false, NULL),
  ('z_off_1',   'ZZ Off Chain', 'Off Dish', false, false, NULL),
  ('z_empty_1', 'ZZ Burgers', 'Alias Row Out', false, true, NULL);

CREATE FUNCTION pg_temp.ids(p_place TEXT, p_name TEXT) RETURNS TEXT[] AS $$
  SELECT COALESCE(array_agg(item_id ORDER BY item_id), '{}')
  FROM public.get_menu_items_for_restaurant(p_place, p_name)
$$ LANGUAGE sql;

DO $$
BEGIN
  ASSERT pg_temp.ids('p1', 'ZZ Burger Chain') = ARRAY['z_chain_1','z_chain_2'], 'exact chain name still works';
  -- normalized variation of the chain name finds the chain menu
  ASSERT pg_temp.ids('p1', 'ZZ BURGER CHAIN') = ARRAY['z_chain_1','z_chain_2'], 'case variation finds the chain menu';
  RAISE NOTICE 'PASS: exact and case-variant names find the chain menu';

  ASSERT pg_temp.ids('p1', 'ZZ Burger Co') = ARRAY['z_chain_1','z_chain_2'], 'alias finds the chain menu';
  ASSERT pg_temp.ids('p1', 'ZZ Off Alias') = '{}', 'inactive chain is not used';
  RAISE NOTICE 'PASS: alias works, inactive chain ignored';

  ASSERT pg_temp.ids('p1', 'ZZ Burgers') = '{}', 'rows stored under the exact name win (all out of stock stays empty)';
  RAISE NOTICE 'PASS: exact-name rows win over the chain';

  -- a store with its own menu keeps it
  ASSERT pg_temp.ids('zz_place_own', 'ZZ Burger Chain') = ARRAY['z_own_1'], 'location own menu wins';
  RAISE NOTICE 'PASS: location menu unchanged';

  -- exact-name rows for a different name win over any chain
  -- (Since migration 103 a name that is not a franchise matches nothing by name alone.)
  ASSERT pg_temp.ids('p1', 'ZZ Burger Chain Cantina') = '{}', 'a non-franchise name is not matched by name alone';
  RAISE NOTICE 'PASS: a non-franchise name matches nothing by name alone';

  -- out-of-stock hidden, unknown name empty
  ASSERT NOT ('z_chain_oos' = ANY (pg_temp.ids('p1', 'ZZ BURGER CHAIN'))), 'out of stock hidden';
  ASSERT pg_temp.ids('p1', 'ZZ Totally Unknown') = '{}', 'unknown name empty';
  RAISE NOTICE 'PASS: out of stock hidden, unknown empty';

  -- NULL place id works the same
  ASSERT pg_temp.ids(NULL, 'ZZ BURGER CHAIN') = ARRAY['z_chain_1','z_chain_2'], 'NULL place id uses the chain menu';
  RAISE NOTICE 'ALL 086 TESTS PASSED';
END $$;

ROLLBACK;

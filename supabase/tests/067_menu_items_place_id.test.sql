-- Tests for migration 067: get_menu_items_for_restaurant (per-location menus,
-- read path). Self-contained: creates its own rows inside a transaction and
-- rolls everything back, so it is safe to run against a real database.
--
-- Run it in the Supabase SQL editor (or psql -f). Success: a series of
-- "PASS: ..." notices and no error. Any failed ASSERT aborts with the test name.
-- Requires migrations 055 (is_out_of_stock) and 067 to be applied.

BEGIN;

-- Fixture: one chain "ZZ Test Chain" with a 3-item shared template (one
-- out of stock), plus its own menus for place_A and (all out of stock) place_C.
INSERT INTO public.menu_items (item_id, restaurant_name, name, is_verified, is_out_of_stock, place_id) VALUES
  ('t_tmpl_1',  'ZZ Test Chain', 'Template Taco',     false, false, NULL),
  ('t_tmpl_2',  'ZZ Test Chain', 'Template Burrito',  false, false, NULL),
  ('t_tmpl_oos','ZZ Test Chain', 'Template Sold Out', false, true,  NULL),
  ('t_a_1',     'ZZ Test Chain', 'A Special',         true,  false, 'place_A'),
  ('t_a_2',     'ZZ Test Chain', 'A Wrap',            true,  false, 'place_A'),
  ('t_a_oos',   'ZZ Test Chain', 'A Sold Out',        true,  true,  'place_A'),
  ('t_c_oos',   'ZZ Test Chain', 'C Only Item',       true,  true,  'place_C'),
  -- A different restaurant, to prove names don't bleed together.
  ('t_other_1', 'ZZ Other Place', 'Other Dish',       false, false, NULL),
  -- An independent restaurant (not on the franchise list) with items stored only by name.
  ('t_indie_1', 'ZZ Indie Cafe', 'Indie Dish',        false, false, NULL);

-- Since migration 103 the shared name-keyed menu is used only for franchises; independents show only items tied
-- to their own place. These two names are franchises so the shared-menu rules below still apply to them.
INSERT INTO public.franchise_chains (name) VALUES ('ZZ Test Chain'), ('ZZ Other Place');

CREATE FUNCTION pg_temp.ids(p_place TEXT, p_name TEXT) RETURNS TEXT[] AS $$
  SELECT COALESCE(array_agg(item_id ORDER BY item_id), '{}')
  FROM public.get_menu_items_for_restaurant(p_place, p_name)
$$ LANGUAGE sql;

DO $$
BEGIN
  -- 1. Template fallback: a location with no menu of its own sees the template.
  ASSERT pg_temp.ids('place_B', 'ZZ Test Chain') = ARRAY['t_tmpl_1','t_tmpl_2'],
    'template fallback for a location with no own rows';
  RAISE NOTICE 'PASS: location without its own menu gets the in-stock template';

  -- 2. Location precedence: place_A has rows, so ONLY those are returned.
  ASSERT pg_temp.ids('place_A', 'ZZ Test Chain') = ARRAY['t_a_1','t_a_2'],
    'location rows replace the template (and out-of-stock is excluded)';
  RAISE NOTICE 'PASS: location with its own menu gets only its own in-stock items';

  -- 3. Template rows never leak into a location that has its own menu.
  ASSERT NOT ('t_tmpl_1' = ANY (pg_temp.ids('place_A', 'ZZ Test Chain'))),
    'template items must not appear for a location with its own menu';
  RAISE NOTICE 'PASS: template items do not leak into a location menu';

  -- 4. Another location's rows never leak into this location.
  ASSERT NOT ('t_a_1' = ANY (pg_temp.ids('place_B', 'ZZ Test Chain'))),
    'place_A items must not appear for place_B';
  RAISE NOTICE 'PASS: one location''s menu does not leak into another location';

  -- 5. Out-of-stock template rows are excluded.
  ASSERT NOT ('t_tmpl_oos' = ANY (pg_temp.ids('place_B', 'ZZ Test Chain'))),
    'out-of-stock template item must be hidden';
  RAISE NOTICE 'PASS: out-of-stock template items are hidden';

  -- 6. A location whose rows are ALL out of stock returns nothing; it must NOT
  --    fall back to the template (the owner deliberately emptied it).
  ASSERT pg_temp.ids('place_C', 'ZZ Test Chain') = '{}',
    'location with only out-of-stock rows must return empty, not the template';
  RAISE NOTICE 'PASS: all-out-of-stock location does not fall back to the template';

  -- 7. NULL place id behaves like the old name-only lookup.
  ASSERT pg_temp.ids(NULL, 'ZZ Test Chain') = ARRAY['t_tmpl_1','t_tmpl_2'],
    'NULL place id uses the template';
  RAISE NOTICE 'PASS: NULL place id falls back to the template';

  -- 8. A franchise is matched by its normalized name (migration 086), so case and spacing variants find
  --    the same shared menu; an independent is never matched by name alone (migration 103).
  ASSERT pg_temp.ids('place_B', 'zz test chain') = ARRAY['t_tmpl_1','t_tmpl_2'],
    'a franchise name matches ignoring case';
  ASSERT pg_temp.ids('place_B', 'ZZ Test Chain ') = ARRAY['t_tmpl_1','t_tmpl_2'],
    'a franchise name matches ignoring spacing';
  ASSERT pg_temp.ids('place_B', 'ZZ Indie Cafe') = '{}',
    'an independent shows nothing just because items share its name';
  RAISE NOTICE 'PASS: franchises match by normalized name, independents never by name alone';

  -- 9. Different restaurants stay separate.
  ASSERT pg_temp.ids('place_B', 'ZZ Other Place') = ARRAY['t_other_1'],
    'other restaurant returns its own template only';
  RAISE NOTICE 'PASS: different restaurant names stay separate';

  -- 10. Unknown restaurant -> empty.
  ASSERT pg_temp.ids('place_X', 'ZZ Does Not Exist') = '{}',
    'unknown restaurant returns nothing';
  RAISE NOTICE 'PASS: unknown restaurant returns nothing';

  -- 11. A location's rows are not returned by a name-only lookup of the same
  --     name from a place with no menu (they are location-owned, not template).
  ASSERT NOT ('t_a_2' = ANY (pg_temp.ids('place_Z', 'ZZ Test Chain'))),
    'location-owned rows must not act as a template';
  RAISE NOTICE 'PASS: location-owned rows never act as a template';

  -- 12. Returned rows carry the columns the app maps (spot check).
  ASSERT EXISTS (
    SELECT 1 FROM public.get_menu_items_for_restaurant('place_A', 'ZZ Test Chain')
    WHERE item_id = 't_a_1' AND name = 'A Special' AND is_verified = true
      AND restaurant_name = 'ZZ Test Chain'
  ), 'returned rows keep their columns';
  RAISE NOTICE 'PASS: returned rows keep their columns';

  RAISE NOTICE 'ALL 067 TESTS PASSED';
END $$;

ROLLBACK;

-- More Google place types in the category mapping (migration 129).
--
-- The restaurant search (Places API (New), migration 144) asks Google for these kinds of place, and the mapping table did not know them, so a place
-- whose types were only one of these was filed under "Restaurant" in the Explore filters:
--
--   donut_shop, bagel_shop   -> Bakery
--   tea_house                -> Cafe
--   sandwich_shop            -> Restaurant
--   bar_and_grill            -> Bar and Restaurant
--
-- Added only where the category still exists (an admin may have removed one), and never replacing anything an admin has already set. The same
-- entries are in DEFAULT_CATALOG in fetch-nearby-restaurants/categories.ts, which is the safety net when this table cannot be read.
-- Safe to re-run.

INSERT INTO public.restaurant_category_map (google_type, category_key)
SELECT v.google_type, v.category_key
FROM (VALUES
  ('donut_shop',    'bakery'),
  ('bagel_shop',    'bakery'),
  ('tea_house',     'cafe'),
  ('sandwich_shop', 'restaurant'),
  ('bar_and_grill', 'bar'),
  ('bar_and_grill', 'restaurant')
) AS v(google_type, category_key)
WHERE EXISTS (SELECT 1 FROM public.restaurant_categories c WHERE c.key = v.category_key)
ON CONFLICT (google_type, category_key) DO NOTHING;

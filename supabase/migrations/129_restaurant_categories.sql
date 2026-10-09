-- Restaurant categories in three separate groups, chosen by the owner (and guessed from Google when the owner has not chosen):
--
--   venue    what the place is:        Restaurant, Cafe or coffee, Bar or pub, Bakery, Fast food, ...   (an owner needs at least one)
--   service  ways to get the food:     Dine-in, Takeaway, Delivery, Drive-thru                          (yes/no switches)
--   cuisine  what it serves:           Italian, Mexican, Indian, ...
--
-- A place can have several of each. This replaces filtering on Google's raw place types, which mixed all three kinds
-- (a cafe that offers takeaway and delivery is one place with five Google tags).
--
--   restaurant_categories         the categories: group, key, label, sort order, on/off. Editable by an admin (Tools).
--   restaurant_category_map       which Google place type counts as which category (a type can map to several).
--   restaurants.venue_types / services / cuisines
--                                 the owner's choices, as category keys. NULL = the owner has not chosen that group, so Google's
--                                 guess is used for it; an empty list (services, cuisines) = the owner chose "none".
--   _check_restaurant_categories  trigger: every write path (claim, owner edit, admin edit) must use known keys of the right
--                                 group, and venue_types cannot be empty when set.
--   get_restaurant_categories()   the active categories (readable before sign-in), for the apps' chips and pickers.
--   categorize_google_types(types) Google's guess for a list of Google place types (no venue match -> Restaurant).
--   admin_*                       the admin's category page and per-restaurant editing. Admin only.
--   get_customer_config           the customer app's single call now also carries the active categories.
--
-- Backward compatible: only new tables, columns and functions; get_customer_config keeps its signature and every old field.
-- An admin's edits to the categories are kept when this is re-run. Safe to re-run.

-- ── 1. Categories ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.restaurant_categories (
  key        TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  grp        TEXT NOT NULL CHECK (grp IN ('venue', 'service', 'cuisine')),
  label      TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.restaurant_category_map (
  google_type  TEXT NOT NULL CHECK (google_type ~ '^[a-z][a-z0-9_]{0,79}$'),
  category_key TEXT NOT NULL REFERENCES public.restaurant_categories(key) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (google_type, category_key)
);
CREATE INDEX IF NOT EXISTS idx_restaurant_category_map_key ON public.restaurant_category_map (category_key);

ALTER TABLE public.restaurant_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_category_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurant_categories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.restaurant_category_map FROM PUBLIC, anon, authenticated;
-- the edge functions use the service role
GRANT ALL ON public.restaurant_categories TO service_role;
GRANT ALL ON public.restaurant_category_map TO service_role;

-- Seed (existing rows, including an admin's edits, are left alone)
INSERT INTO public.restaurant_categories (key, grp, label, sort_order) VALUES
  ('restaurant', 'venue', 'Restaurant', 10),
  ('cafe', 'venue', 'Cafe or coffee', 20),
  ('bar', 'venue', 'Bar or pub', 30),
  ('bakery', 'venue', 'Bakery', 40),
  ('fast_food', 'venue', 'Fast food', 50),
  ('dessert', 'venue', 'Dessert or ice cream', 60),
  ('juice', 'venue', 'Juice or smoothie', 70),
  ('food_truck', 'venue', 'Food truck', 80),
  ('dine_in', 'service', 'Dine-in', 10),
  ('takeaway', 'service', 'Takeaway', 20),
  ('delivery', 'service', 'Delivery', 30),
  ('drive_thru', 'service', 'Drive-thru', 40),
  ('italian', 'cuisine', 'Italian', 10),
  ('mexican', 'cuisine', 'Mexican', 20),
  ('indian', 'cuisine', 'Indian', 30),
  ('chinese', 'cuisine', 'Chinese', 40),
  ('japanese', 'cuisine', 'Japanese', 50),
  ('thai', 'cuisine', 'Thai', 60),
  ('asian', 'cuisine', 'Asian', 70),
  ('mediterranean', 'cuisine', 'Mediterranean', 80),
  ('american', 'cuisine', 'American', 90),
  ('french', 'cuisine', 'French', 100),
  ('seafood', 'cuisine', 'Seafood', 110),
  ('other', 'cuisine', 'Other', 900)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.restaurant_category_map (google_type, category_key) VALUES
  ('restaurant', 'restaurant'),
  ('cafe', 'cafe'), ('coffee_shop', 'cafe'),
  ('bar', 'bar'), ('pub', 'bar'), ('night_club', 'bar'), ('wine_bar', 'bar'),
  ('bakery', 'bakery'),
  ('fast_food_restaurant', 'fast_food'),
  ('ice_cream_shop', 'dessert'), ('dessert_shop', 'dessert'),
  ('juice_shop', 'juice'),
  ('meal_takeaway', 'takeaway'),
  ('meal_delivery', 'delivery'),
  ('italian_restaurant', 'italian'), ('pizza_restaurant', 'italian'),
  ('mexican_restaurant', 'mexican'),
  ('indian_restaurant', 'indian'),
  ('chinese_restaurant', 'chinese'),
  ('japanese_restaurant', 'japanese'), ('sushi_restaurant', 'japanese'), ('ramen_restaurant', 'japanese'),
  ('thai_restaurant', 'thai'),
  ('asian_restaurant', 'asian'), ('korean_restaurant', 'asian'), ('vietnamese_restaurant', 'asian'),
  ('mediterranean_restaurant', 'mediterranean'), ('greek_restaurant', 'mediterranean'), ('turkish_restaurant', 'mediterranean'),
  ('lebanese_restaurant', 'mediterranean'), ('middle_eastern_restaurant', 'mediterranean'),
  ('american_restaurant', 'american'), ('hamburger_restaurant', 'american'), ('barbecue_restaurant', 'american'), ('steak_house', 'american'),
  ('french_restaurant', 'french'),
  ('seafood_restaurant', 'seafood')
ON CONFLICT (google_type, category_key) DO NOTHING;

-- ── 2. The owner's choices ──────────────────────────────────────────────────
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS venue_types TEXT[];
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS services TEXT[];
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS cuisines TEXT[];

-- Every write must use known keys of the right group, without repeats, and a chosen venue list cannot be empty.
CREATE OR REPLACE FUNCTION public._check_restaurant_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_bad TEXT;
BEGIN
  IF NEW.venue_types IS NOT NULL THEN
    IF cardinality(NEW.venue_types) = 0 THEN RAISE EXCEPTION 'Choose at least one place type'; END IF;
    SELECT k INTO v_bad FROM unnest(NEW.venue_types) k
      WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_categories c WHERE c.key = k AND c.grp = 'venue') LIMIT 1;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Unknown place type: %', v_bad; END IF;
    IF (SELECT COUNT(DISTINCT k) FROM unnest(NEW.venue_types) k) <> cardinality(NEW.venue_types) THEN
      RAISE EXCEPTION 'A place type is listed twice';
    END IF;
  END IF;
  IF NEW.services IS NOT NULL THEN
    SELECT k INTO v_bad FROM unnest(NEW.services) k
      WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_categories c WHERE c.key = k AND c.grp = 'service') LIMIT 1;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Unknown way to order: %', v_bad; END IF;
    IF (SELECT COUNT(DISTINCT k) FROM unnest(NEW.services) k) <> cardinality(NEW.services) THEN
      RAISE EXCEPTION 'A way to order is listed twice';
    END IF;
  END IF;
  IF NEW.cuisines IS NOT NULL THEN
    SELECT k INTO v_bad FROM unnest(NEW.cuisines) k
      WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_categories c WHERE c.key = k AND c.grp = 'cuisine') LIMIT 1;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Unknown cuisine: %', v_bad; END IF;
    IF (SELECT COUNT(DISTINCT k) FROM unnest(NEW.cuisines) k) <> cardinality(NEW.cuisines) THEN
      RAISE EXCEPTION 'A cuisine is listed twice';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_restaurant_categories ON public.restaurants;
CREATE TRIGGER trg_check_restaurant_categories
  BEFORE INSERT OR UPDATE OF venue_types, services, cuisines ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public._check_restaurant_categories();

-- ── 3. Reading the categories ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_restaurant_categories()
RETURNS TABLE (key TEXT, grp TEXT, label TEXT, sort_order INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.key, c.grp, c.label, c.sort_order
  FROM public.restaurant_categories c
  WHERE c.is_active
  ORDER BY c.grp, c.sort_order, c.label;
$$;

REVOKE ALL ON FUNCTION public.get_restaurant_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_categories() TO anon, authenticated;

-- Google's guess for a list of Google place types. A place with no place type among them is a Restaurant.
CREATE OR REPLACE FUNCTION public.categorize_google_types(p_types TEXT[])
RETURNS TABLE (key TEXT, grp TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH hit AS (
    SELECT DISTINCT c.key AS k, c.grp AS g
    FROM public.restaurant_category_map m
    JOIN public.restaurant_categories c ON c.key = m.category_key AND c.is_active
    WHERE m.google_type = ANY(COALESCE(p_types, ARRAY[]::TEXT[]))
  )
  SELECT k, g FROM hit
  UNION ALL
  SELECT c.key, c.grp FROM public.restaurant_categories c
  WHERE c.key = 'restaurant' AND c.is_active AND NOT EXISTS (SELECT 1 FROM hit WHERE g = 'venue');
$$;

REVOKE ALL ON FUNCTION public.categorize_google_types(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.categorize_google_types(TEXT[]) TO anon, authenticated;

-- ── 4. The customer app's one call also carries the categories ──────────────
CREATE OR REPLACE FUNCTION public.get_customer_config(p_app_version TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
           (SELECT jsonb_object_agg(c.key, c.value)
            FROM public.app_config c
            WHERE c.key IN ('maxRadiusMiles', 'showUnconfirmedMenuItems', 'minAppVersion')),
           '{}'::jsonb)
         || jsonb_build_object(
              'announcements',
              COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.get_active_announcements('customer', p_app_version) a), '[]'::jsonb),
              'categories',
              COALESCE((SELECT jsonb_agg(to_jsonb(k)) FROM public.get_restaurant_categories() k), '[]'::jsonb)
            );
$$;

REVOKE ALL ON FUNCTION public.get_customer_config(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_config(TEXT) TO anon, authenticated;

-- ── 5. The admin: the categories page ───────────────────────────────────────
-- Everything on the page in one call: every category (also the switched-off ones) and every Google mapping.
CREATE OR REPLACE FUNCTION public.admin_list_restaurant_categories()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN jsonb_build_object(
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'key', c.key, 'grp', c.grp, 'label', c.label, 'sort_order', c.sort_order, 'is_active', c.is_active,
               'restaurants', (SELECT COUNT(*) FROM public.restaurants r
                               WHERE c.key = ANY(COALESCE(r.venue_types, ARRAY[]::TEXT[]))
                                  OR c.key = ANY(COALESCE(r.services, ARRAY[]::TEXT[]))
                                  OR c.key = ANY(COALESCE(r.cuisines, ARRAY[]::TEXT[])))
             ) ORDER BY c.grp, c.sort_order, c.label)
      FROM public.restaurant_categories c), '[]'::jsonb),
    'mappings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('google_type', m.google_type, 'category_key', m.category_key)
                       ORDER BY m.category_key, m.google_type)
      FROM public.restaurant_category_map m), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_restaurant_categories() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_restaurant_categories() TO authenticated;

-- Adds a category or changes its label, order or on/off switch. The group of an existing category cannot change.
CREATE OR REPLACE FUNCTION public.admin_save_restaurant_category(
  p_key TEXT, p_grp TEXT, p_label TEXT, p_sort_order INTEGER, p_is_active BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key   TEXT := lower(btrim(COALESCE(p_key, '')));
  v_label TEXT := btrim(COALESCE(p_label, ''));
  v_old   TEXT;
BEGIN
  PERFORM public._require_admin();
  IF v_key !~ '^[a-z][a-z0-9_]{0,39}$' THEN RAISE EXCEPTION 'The key must be lowercase letters, numbers and underscores, starting with a letter'; END IF;
  IF p_grp IS NULL OR p_grp NOT IN ('venue', 'service', 'cuisine') THEN RAISE EXCEPTION 'Choose a group: venue, service or cuisine'; END IF;
  IF char_length(v_label) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'The label must be 1 to 40 characters'; END IF;

  SELECT c.grp INTO v_old FROM public.restaurant_categories c WHERE c.key = v_key;
  IF v_old IS NOT NULL AND v_old <> p_grp THEN RAISE EXCEPTION 'A category cannot move to another group'; END IF;

  INSERT INTO public.restaurant_categories (key, grp, label, sort_order, is_active)
  VALUES (v_key, p_grp, v_label, COALESCE(p_sort_order, 100), COALESCE(p_is_active, TRUE))
  ON CONFLICT (key) DO UPDATE
    SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_restaurant_category(TEXT, TEXT, TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_restaurant_category(TEXT, TEXT, TEXT, INTEGER, BOOLEAN) TO authenticated;

-- Maps (p_enabled) or unmaps a Google place type for a category.
CREATE OR REPLACE FUNCTION public.admin_set_category_mapping(p_google_type TEXT, p_category_key TEXT, p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT := lower(btrim(COALESCE(p_google_type, '')));
BEGIN
  PERFORM public._require_admin();
  IF v_type !~ '^[a-z][a-z0-9_]{0,79}$' THEN RAISE EXCEPTION 'A Google place type looks like cafe or italian_restaurant'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.restaurant_categories c WHERE c.key = p_category_key) THEN RAISE EXCEPTION 'Unknown category'; END IF;
  IF COALESCE(p_enabled, TRUE) THEN
    INSERT INTO public.restaurant_category_map (google_type, category_key) VALUES (v_type, p_category_key) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.restaurant_category_map m WHERE m.google_type = v_type AND m.category_key = p_category_key;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_category_mapping(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_category_mapping(TEXT, TEXT, BOOLEAN) TO authenticated;

-- ── 6. The admin: one restaurant ────────────────────────────────────────────
-- The owner's choices, Google's types and Google's guess for one restaurant.
CREATE OR REPLACE FUNCTION public.admin_get_restaurant_categories(p_restaurant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r      public.restaurants%ROWTYPE;
  v_g    TEXT[];
BEGIN
  PERFORM public._require_admin();
  SELECT * INTO r FROM public.restaurants x WHERE x.id = p_restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  SELECT cr.cuisine_types INTO v_g FROM public.cached_restaurants cr WHERE cr.place_id = r.google_place_id;
  RETURN jsonb_build_object(
    'venue_types', to_jsonb(r.venue_types),
    'services', to_jsonb(r.services),
    'cuisines', to_jsonb(r.cuisines),
    'google_types', COALESCE(to_jsonb(v_g), '[]'::jsonb),
    'google_guess', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', g.key, 'grp', g.grp)) FROM public.categorize_google_types(v_g) g), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_restaurant_categories(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_restaurant_categories(UUID) TO authenticated;

-- Sets a restaurant's categories. A NULL list resets that group to Google's guess.
CREATE OR REPLACE FUNCTION public.admin_set_restaurant_categories(
  p_restaurant_id UUID, p_venue_types TEXT[], p_services TEXT[], p_cuisines TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  UPDATE public.restaurants r
     SET venue_types = p_venue_types, services = p_services, cuisines = p_cuisines, updated_at = NOW()
   WHERE r.id = p_restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_restaurant_categories(UUID, TEXT[], TEXT[], TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_restaurant_categories(UUID, TEXT[], TEXT[], TEXT[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

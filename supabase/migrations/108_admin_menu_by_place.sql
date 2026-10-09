-- Admin Menu Management works on ONE location at a time for independent restaurants.
--
-- Until now the admin list, view and Manual Edit pages worked by restaurant NAME, so for two restaurants called
-- "Cactus Grill" they mixed both locations' items and warned that a change applies to both. Independent
-- restaurants' items are now tied to their own place (migrations 100 to 104), so:
--
--   admin_list_restaurants_with_menu_counts()   independents are listed one row per LOCATION (with its place ID);
--                                               franchises stay one row per name, as before. Two columns are added
--                                               at the end: place_id and is_franchise.
--   admin_get_restaurant_menu(name, place)      the items of ONE place when a place is given, else the shared menu
--   admin_get_restaurant_menu_for_edit(...)     (name-keyed items only: place IS NULL)
--   admin_menu_sharing_info(name, place)        also says whether the name is a franchise (a place has no sharing)
--   admin_save_menu_item(..., place)            adds or edits an item of ONE place (never a franchise); the duplicate
--                                               check is within that place
--
-- Every new parameter is optional (NULL = the old, shared-by-name behaviour), so a franchise page works as before.
-- The functions are dropped and recreated because their shape or arguments changed. Same pattern as the other admin
-- functions: SECURITY DEFINER + _require_admin(), signed-in users only. Safe to re-run.

-- ── 1. The list ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_restaurants_with_menu_counts();

CREATE FUNCTION public.admin_list_restaurants_with_menu_counts()
RETURNS TABLE (
  restaurant_name          TEXT,
  address                  TEXT,
  source                   TEXT,
  restaurant_id            UUID,
  status                   TEXT,
  owner_business_name      TEXT,
  owner_email              TEXT,
  location_count           BIGINT,
  shares_menu_with_claimed BOOLEAN,
  total_items              BIGINT,
  verified_items           BIGINT,
  unverified_items         BIGINT,
  place_id                 TEXT,
  is_franchise             BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  WITH chain_norms AS (
    SELECT fc.normalized_name AS n FROM public.franchise_chains fc WHERE fc.is_active
    UNION
    SELECT public.normalize_restaurant_name(a) FROM public.franchise_chains fc2, unnest(fc2.aliases) AS a WHERE fc2.is_active
  ),
  claimed AS (
    SELECT r.id, r.name, r.address, r.status::TEXT AS rstatus, r.google_place_id,
           ro.business_name, ro.email AS owner_email,
           (public.normalize_restaurant_name(r.name) IN (SELECT n FROM chain_norms)) AS fr
    FROM public.restaurants r
    LEFT JOIN public.restaurant_owners ro ON ro.id = r.owner_id
  ),
  cached_all AS (
    -- Unclaimed cached locations only.
    SELECT cr.place_id AS pid, cr.name, cr.address,
           (public.normalize_restaurant_name(cr.name) IN (SELECT n FROM chain_norms)) AS fr
    FROM public.cached_restaurants cr
    WHERE NOT EXISTS (SELECT 1 FROM claimed c WHERE c.google_place_id = cr.place_id)
  ),
  combined AS (
    -- claimed: one row each
    SELECT c.name, c.address, 'claimed'::TEXT AS src, c.id AS rid, c.rstatus AS rst,
           c.business_name AS biz, c.owner_email AS oemail, 1::BIGINT AS locs, FALSE AS shares,
           c.google_place_id AS pid, c.fr
    FROM claimed c
    UNION ALL
    -- unclaimed franchise locations: one row per name (one shared menu)
    SELECT ca.name, MIN(ca.address), 'cached'::TEXT, NULL::UUID, NULL::TEXT,
           NULL::TEXT, NULL::TEXT, COUNT(*)::BIGINT,
           EXISTS (SELECT 1 FROM claimed c2 WHERE c2.name = ca.name),
           NULL::TEXT, TRUE
    FROM cached_all ca
    WHERE ca.fr
    GROUP BY ca.name
    UNION ALL
    -- unclaimed independents: one row per location (each has its own menu)
    SELECT ca.name, ca.address, 'cached'::TEXT, NULL::UUID, NULL::TEXT,
           NULL::TEXT, NULL::TEXT, 1::BIGINT, FALSE, ca.pid, FALSE
    FROM cached_all ca
    WHERE NOT ca.fr
  ),
  name_counts AS (
    -- the shared, name-keyed menu (franchises)
    SELECT mi.restaurant_name AS rname,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE COALESCE(mi.is_verified, false)) AS verified
    FROM public.menu_items mi
    WHERE mi.place_id IS NULL
    GROUP BY mi.restaurant_name
  ),
  place_counts AS (
    -- one location's own menu (independents)
    SELECT mi.place_id AS pid,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE COALESCE(mi.is_verified, false)) AS verified
    FROM public.menu_items mi
    WHERE mi.place_id IS NOT NULL
    GROUP BY mi.place_id
  )
  SELECT
    cb.name,
    cb.address,
    cb.src,
    cb.rid,
    cb.rst,
    cb.biz,
    cb.oemail,
    cb.locs,
    cb.shares,
    COALESCE(CASE WHEN cb.fr THEN nc.total ELSE pc.total END, 0),
    COALESCE(CASE WHEN cb.fr THEN nc.verified ELSE pc.verified END, 0),
    COALESCE(CASE WHEN cb.fr THEN nc.total ELSE pc.total END, 0)
      - COALESCE(CASE WHEN cb.fr THEN nc.verified ELSE pc.verified END, 0),
    cb.pid,
    cb.fr
  FROM combined cb
  LEFT JOIN name_counts nc ON nc.rname = cb.name
  LEFT JOIN place_counts pc ON pc.pid = cb.pid
  ORDER BY cb.name, cb.src, cb.address;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_restaurants_with_menu_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_restaurants_with_menu_counts() TO authenticated;

-- ── 2. One restaurant's items (read only) ───────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_get_restaurant_menu(TEXT);

CREATE FUNCTION public.admin_get_restaurant_menu(p_restaurant_name TEXT, p_place_id TEXT DEFAULT NULL)
RETURNS TABLE (
  item_id          TEXT,
  name             TEXT,
  calories         INTEGER,
  protein_g        NUMERIC,
  total_carbs_g    NUMERIC,
  total_fat_g      NUMERIC,
  saturated_fat_g  NUMERIC,
  sodium_mg        INTEGER,
  is_verified      BOOLEAN,
  is_out_of_stock  BOOLEAN,
  nutrition_source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    mi.item_id, mi.name, mi.calories, mi.protein_g, mi.total_carbs_g, mi.total_fat_g, mi.saturated_fat_g,
    mi.sodium_mg, COALESCE(mi.is_verified, false), COALESCE(mi.is_out_of_stock, false), mi.nutrition_source
  FROM public.menu_items mi
  WHERE CASE WHEN p_place_id IS NOT NULL
             THEN mi.place_id = p_place_id
             ELSE mi.restaurant_name = p_restaurant_name AND mi.place_id IS NULL END
  ORDER BY mi.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_restaurant_menu(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_restaurant_menu(TEXT, TEXT) TO authenticated;

-- ── 3. One restaurant's items, with every column the edit form needs ────────
DROP FUNCTION IF EXISTS public.admin_get_restaurant_menu_for_edit(TEXT);

CREATE FUNCTION public.admin_get_restaurant_menu_for_edit(p_restaurant_name TEXT, p_place_id TEXT DEFAULT NULL)
RETURNS TABLE (
  item_id              TEXT,
  name                 TEXT,
  calories             INTEGER,
  protein_g            NUMERIC,
  total_carbs_g        NUMERIC,
  total_fat_g          NUMERIC,
  saturated_fat_g      NUMERIC,
  sodium_mg            INTEGER,
  dietary_fiber_g      NUMERIC,
  sugars_g             NUMERIC,
  serving_weight_grams NUMERIC,
  is_verified          BOOLEAN,
  is_out_of_stock      BOOLEAN,
  nutrition_source     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    mi.item_id, mi.name, mi.calories, mi.protein_g, mi.total_carbs_g,
    mi.total_fat_g, mi.saturated_fat_g, mi.sodium_mg, mi.dietary_fiber_g,
    mi.sugars_g, mi.serving_weight_grams,
    COALESCE(mi.is_verified, false),
    COALESCE(mi.is_out_of_stock, false),
    mi.nutrition_source
  FROM public.menu_items mi
  WHERE CASE WHEN p_place_id IS NOT NULL
             THEN mi.place_id = p_place_id
             ELSE mi.restaurant_name = p_restaurant_name AND mi.place_id IS NULL END
  ORDER BY mi.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_restaurant_menu_for_edit(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_restaurant_menu_for_edit(TEXT, TEXT) TO authenticated;

-- ── 4. How many locations share this menu ───────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_menu_sharing_info(TEXT);

CREATE FUNCTION public.admin_menu_sharing_info(p_restaurant_name TEXT, p_place_id TEXT DEFAULT NULL)
RETURNS TABLE (cached_locations BIGINT, claimed_locations BIGINT, is_franchise BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  -- one location's own menu is shared with nobody
  IF p_place_id IS NOT NULL THEN
    RETURN QUERY SELECT 0::BIGINT, 0::BIGINT, public.is_franchise_chain(p_restaurant_name);
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.cached_restaurants cr WHERE cr.name = p_restaurant_name),
    (SELECT COUNT(*) FROM public.restaurants r WHERE r.name = p_restaurant_name),
    public.is_franchise_chain(p_restaurant_name);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_menu_sharing_info(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_menu_sharing_info(TEXT, TEXT) TO authenticated;

-- ── 5. Add or update one item ───────────────────────────────────────────────
-- As migration 070, with an optional place: a new item is created for THAT place (never for a franchise, which has
-- one shared menu), and the duplicate-name check stays inside the place.
DROP FUNCTION IF EXISTS public.admin_save_menu_item(
  TEXT, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN
);

CREATE FUNCTION public.admin_save_menu_item(
  p_restaurant_name      TEXT,
  p_item_id              TEXT,
  p_name                 TEXT,
  p_calories             INTEGER,
  p_protein_g            NUMERIC,
  p_total_carbs_g        NUMERIC,
  p_total_fat_g          NUMERIC,
  p_saturated_fat_g      NUMERIC,
  p_sodium_mg            INTEGER,
  p_dietary_fiber_g      NUMERIC,
  p_sugars_g             NUMERIC,
  p_serving_weight_grams NUMERIC,
  p_is_verified          BOOLEAN,
  p_is_out_of_stock      BOOLEAN,
  p_place_id             TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest     TEXT := btrim(COALESCE(p_restaurant_name, ''));
  v_name     TEXT := btrim(COALESCE(p_name, ''));
  v_id       TEXT;
  v_existing public.menu_items%ROWTYPE;
  v_changed  BOOLEAN;
BEGIN
  PERFORM public._require_admin();

  IF v_rest = '' THEN RAISE EXCEPTION 'Restaurant name is required'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'Item name is required'; END IF;
  IF p_calories IS NULL THEN RAISE EXCEPTION 'Calories are required'; END IF;
  IF p_calories < 0
     OR COALESCE(p_protein_g, 0) < 0 OR COALESCE(p_total_carbs_g, 0) < 0
     OR COALESCE(p_total_fat_g, 0) < 0 OR COALESCE(p_saturated_fat_g, 0) < 0
     OR COALESCE(p_sodium_mg, 0) < 0 OR COALESCE(p_dietary_fiber_g, 0) < 0
     OR COALESCE(p_sugars_g, 0) < 0 OR COALESCE(p_serving_weight_grams, 0) < 0 THEN
    RAISE EXCEPTION 'Nutrition values cannot be negative';
  END IF;
  IF p_place_id IS NOT NULL AND p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' THEN
    RAISE EXCEPTION 'That is not a valid Google place ID';
  END IF;

  IF p_item_id IS NULL THEN
    -- Create
    IF p_place_id IS NOT NULL AND public.is_franchise_chain(v_rest) THEN
      RAISE EXCEPTION 'A franchise has one shared menu: add its items without a location';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.menu_items mi
      WHERE lower(btrim(mi.name)) = lower(v_name)
        AND CASE WHEN p_place_id IS NOT NULL
                 THEN mi.place_id = p_place_id
                 ELSE mi.restaurant_name = v_rest AND mi.place_id IS NULL END
    ) THEN
      RAISE EXCEPTION 'An item named "%" already exists for this restaurant', v_name;
    END IF;

    v_id := public.admin_menu_item_id(v_rest, v_name);
    IF p_place_id IS NOT NULL THEN
      v_id := public.place_item_id(p_place_id, v_id);
    END IF;

    INSERT INTO public.menu_items (
      item_id, restaurant_name, name, calories, protein_g, total_carbs_g,
      total_fat_g, saturated_fat_g, sodium_mg, dietary_fiber_g, sugars_g,
      serving_weight_grams, is_verified, is_out_of_stock, nutrition_source, cached_at, place_id
    ) VALUES (
      v_id, v_rest, v_name, p_calories,
      COALESCE(p_protein_g, 0), COALESCE(p_total_carbs_g, 0),
      COALESCE(p_total_fat_g, 0), COALESCE(p_saturated_fat_g, 0),
      COALESCE(p_sodium_mg, 0), COALESCE(p_dietary_fiber_g, 0),
      COALESCE(p_sugars_g, 0), p_serving_weight_grams,
      COALESCE(p_is_verified, false), COALESCE(p_is_out_of_stock, false),
      'owner_provided', NOW(), p_place_id
    );

    RETURN jsonb_build_object('itemId', v_id, 'created', true);
  END IF;

  -- Update
  SELECT * INTO v_existing FROM public.menu_items mi WHERE mi.item_id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Menu item not found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.restaurant_name = v_existing.restaurant_name
      AND mi.place_id IS NOT DISTINCT FROM v_existing.place_id
      AND mi.item_id <> p_item_id
      AND lower(btrim(mi.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'Another item named "%" already exists for this restaurant', v_name;
  END IF;

  v_changed :=
    v_existing.calories        IS DISTINCT FROM p_calories
    OR v_existing.protein_g     IS DISTINCT FROM COALESCE(p_protein_g, 0)
    OR v_existing.total_carbs_g IS DISTINCT FROM COALESCE(p_total_carbs_g, 0)
    OR v_existing.total_fat_g   IS DISTINCT FROM COALESCE(p_total_fat_g, 0)
    OR v_existing.saturated_fat_g IS DISTINCT FROM COALESCE(p_saturated_fat_g, 0)
    OR v_existing.sodium_mg     IS DISTINCT FROM COALESCE(p_sodium_mg, 0)
    OR v_existing.dietary_fiber_g IS DISTINCT FROM COALESCE(p_dietary_fiber_g, 0)
    OR v_existing.sugars_g      IS DISTINCT FROM COALESCE(p_sugars_g, 0)
    OR v_existing.serving_weight_grams IS DISTINCT FROM p_serving_weight_grams;

  UPDATE public.menu_items SET
    name                 = v_name,
    calories             = p_calories,
    protein_g            = COALESCE(p_protein_g, 0),
    total_carbs_g        = COALESCE(p_total_carbs_g, 0),
    total_fat_g          = COALESCE(p_total_fat_g, 0),
    saturated_fat_g      = COALESCE(p_saturated_fat_g, 0),
    sodium_mg            = COALESCE(p_sodium_mg, 0),
    dietary_fiber_g      = COALESCE(p_dietary_fiber_g, 0),
    sugars_g             = COALESCE(p_sugars_g, 0),
    serving_weight_grams = p_serving_weight_grams,
    is_verified          = COALESCE(p_is_verified, false),
    is_out_of_stock      = COALESCE(p_is_out_of_stock, false),
    nutrition_source     = CASE WHEN v_changed THEN 'owner_provided' ELSE nutrition_source END,
    cached_at            = NOW()
  WHERE item_id = p_item_id;

  RETURN jsonb_build_object('itemId', p_item_id, 'created', false);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_menu_item(
  TEXT, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_menu_item(
  TEXT, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, TEXT
) TO authenticated;

NOTIFY pgrst, 'reload schema';

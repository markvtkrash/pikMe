-- Read-only menu visibility for the admin Menu Management page. Until now an
-- admin could only REPLACE a claimed restaurant's menu (photo / pasted text),
-- never see what's currently on it, and cached restaurants (chains like
-- McDonald's, which have no owner) weren't listed at all.
--
-- Two admin-gated RPCs, same pattern as the 045/046/063 reports:
--   1. admin_list_restaurants_with_menu_counts: every owner-claimed restaurant
--      plus every cached restaurant, with how many menu items each has.
--   2. admin_get_restaurant_menu: the actual items for one restaurant.
--
-- menu_items is keyed by restaurant NAME (not place id), so a chain with many
-- cached locations shows up once, with one shared item set. Claimed vs cached
-- is decided by Google place ID (see the function below).

-- ── 1. All restaurants with menu item counts ────────────────────────────────
-- Claimed vs cached is decided by Google place ID (restaurants.google_place_id
-- = cached_restaurants.place_id — both unique per physical location), NOT by
-- name: claiming one branch of a chain must not mark every other cached
-- branch as claimed. A claimed restaurant is listed once (its cache row, if
-- any, is merged into it); the remaining unclaimed cached locations of the
-- same name are listed together as one "cached" row. Menu items still match
-- by NAME (menu_items has no place id), so such a cached row and the claimed
-- branch share one item set; shares_menu_with_claimed flags that.
-- The return shape gained a column, so the old function has to be dropped.
DROP FUNCTION IF EXISTS public.admin_list_restaurants_with_menu_counts();

CREATE FUNCTION public.admin_list_restaurants_with_menu_counts()
RETURNS TABLE (
  restaurant_name TEXT,
  address TEXT,
  source TEXT,
  restaurant_id UUID,
  status TEXT,
  owner_business_name TEXT,
  owner_email TEXT,
  location_count BIGINT,
  shares_menu_with_claimed BOOLEAN,
  total_items BIGINT,
  verified_items BIGINT,
  unverified_items BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  WITH claimed AS (
    SELECT r.id, r.name, r.address, r.status::TEXT AS status, r.google_place_id,
           ro.business_name, ro.email AS owner_email
    FROM public.restaurants r
    LEFT JOIN public.restaurant_owners ro ON ro.id = r.owner_id
  ),
  cached AS (
    -- Unclaimed cached locations only, grouped by name.
    SELECT cr.name, MIN(cr.address) AS address, COUNT(*) AS locs
    FROM public.cached_restaurants cr
    WHERE NOT EXISTS (
      SELECT 1 FROM claimed c WHERE c.google_place_id = cr.place_id
    )
    GROUP BY cr.name
  ),
  combined AS (
    SELECT c.name, c.address, 'claimed'::TEXT AS source, c.id, c.status,
           c.business_name, c.owner_email, 1::BIGINT AS locs, FALSE AS shares
    FROM claimed c
    UNION ALL
    SELECT ca.name, ca.address, 'cached'::TEXT, NULL::UUID, NULL::TEXT,
           NULL::TEXT, NULL::TEXT, ca.locs,
           EXISTS (SELECT 1 FROM claimed c WHERE c.name = ca.name)
    FROM cached ca
  ),
  counts AS (
    SELECT mi.restaurant_name AS rname,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE COALESCE(mi.is_verified, false)) AS verified
    FROM public.menu_items mi
    GROUP BY mi.restaurant_name
  )
  SELECT
    cb.name,
    cb.address,
    cb.source,
    cb.id,
    cb.status,
    cb.business_name,
    cb.owner_email,
    cb.locs,
    cb.shares,
    COALESCE(ct.total, 0),
    COALESCE(ct.verified, 0),
    COALESCE(ct.total, 0) - COALESCE(ct.verified, 0)
  FROM combined cb
  LEFT JOIN counts ct ON ct.rname = cb.name
  ORDER BY cb.name, cb.source;
END;
$$;

-- ── 2. One restaurant's menu items ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_restaurant_menu(p_restaurant_name TEXT)
RETURNS TABLE (
  item_id TEXT,
  name TEXT,
  calories INTEGER,
  protein_g NUMERIC,
  total_carbs_g NUMERIC,
  total_fat_g NUMERIC,
  saturated_fat_g NUMERIC,
  sodium_mg INTEGER,
  is_verified BOOLEAN,
  is_out_of_stock BOOLEAN,
  nutrition_source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    mi.item_id,
    mi.name,
    mi.calories,
    mi.protein_g,
    mi.total_carbs_g,
    mi.total_fat_g,
    mi.saturated_fat_g,
    mi.sodium_mg,
    COALESCE(mi.is_verified, false),
    COALESCE(mi.is_out_of_stock, false),
    mi.nutrition_source
  FROM public.menu_items mi
  WHERE mi.restaurant_name = p_restaurant_name
  ORDER BY mi.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_restaurants_with_menu_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_restaurant_menu(TEXT) TO authenticated;

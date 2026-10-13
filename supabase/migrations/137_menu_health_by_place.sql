-- Menu Data Health report: correct counts, filtered by region and city, with a link to each restaurant's menu.
--
-- Before: the three report functions (migrations 046 and 047) matched menu items to restaurants by NAME only. Since menus became
-- place-keyed (migrations 099 / 103) that added in every item of every same-named location and of the shared, name-keyed menu,
-- so a restaurant could show unverified items that Menu Management (which shows only the restaurant's own place) did not have.
--
-- Now every function counts the way Menu Management does (migration 108 / 136):
--   an independent restaurant   only the items tied to its own Google place ID (none when it has no place ID)
--   a franchise                 the shared, name-keyed items (no place ID) for that exact name
--   verified                    COALESCE(is_verified, false); everything else counts as unverified
-- The scope is claimed restaurants that are approved or pending (as the by-restaurant table and the no-items list always were).
--
-- The report is filtered on the server, so it never loads the whole country:
--   p_state   NULL or '' = every region; '__none__' = restaurants whose address has no readable state; else a state code (any case)
--   p_city    NULL or '' = every city; else a city name (any case)
-- City and state are read from the address (migration 136).
--
--   _menu_health_rows(state, city)           one row per restaurant with its verified / unverified counts (internal)
--   admin_report_menu_health_snapshot        the headline numbers for the filter, plus the number of restaurants
--   admin_report_menu_health_by_restaurant   the table, restaurants with at least one item, a page at a time (limit 1-200, default 50)
--   admin_report_restaurants_no_menu_items   restaurants with no items, a page at a time
--   admin_menu_health_locations              the regions and cities that have restaurants, with counts, for the filter pickers
-- The first three keep working when called with no arguments (every region, first 50).
--
-- Safe to re-run.

DROP FUNCTION IF EXISTS public.admin_report_menu_health_snapshot();
DROP FUNCTION IF EXISTS public.admin_report_menu_health_snapshot(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_report_menu_health_by_restaurant();
DROP FUNCTION IF EXISTS public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.admin_report_restaurants_no_menu_items();
DROP FUNCTION IF EXISTS public.admin_report_restaurants_no_menu_items(TEXT, TEXT, INTEGER, INTEGER);

-- ── 1. The shared base ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._menu_health_rows(p_state TEXT, p_city TEXT)
RETURNS TABLE (
  mh_id         UUID,
  mh_name       TEXT,
  mh_status     TEXT,
  mh_claimed_at TIMESTAMPTZ,
  mh_place_id   TEXT,
  mh_address    TEXT,
  mh_franchise  BOOLEAN,
  mh_city       TEXT,
  mh_state      TEXT,
  mh_verified   BIGINT,
  mh_unverified BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH chain_norms AS (
    SELECT fc.normalized_name AS n FROM public.franchise_chains fc WHERE fc.is_active
    UNION
    SELECT public.normalize_restaurant_name(a) FROM public.franchise_chains fc2, unnest(fc2.aliases) AS a WHERE fc2.is_active
  ),
  base AS (
    SELECT r.id AS rid, r.name AS rname, r.status::TEXT AS rstatus, r.claimed_at AS rclaimed, r.google_place_id AS pid,
           r.address AS raddress,
           (public.normalize_restaurant_name(r.name) IN (SELECT n FROM chain_norms)) AS fr,
           public.address_city(r.address) AS rcity, public.address_state(r.address) AS rstate
    FROM public.restaurants r
    WHERE r.status IN ('approved', 'pending')
  ),
  picked AS (
    SELECT b.* FROM base b
    WHERE (COALESCE(btrim(p_state), '') = ''
           OR (btrim(p_state) = '__none__' AND b.rstate IS NULL)
           OR lower(b.rstate) = lower(btrim(p_state)))
      AND (COALESCE(btrim(p_city), '') = '' OR lower(btrim(b.rcity)) = lower(btrim(p_city)))
  )
  SELECT p.rid, p.rname, p.rstatus, p.rclaimed, p.pid, p.raddress, p.fr, p.rcity, p.rstate,
         COALESCE(c.v, 0)::BIGINT, COALESCE(c.u, 0)::BIGINT
  FROM picked p
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE COALESCE(mi.is_verified, false)) AS v,
           COUNT(*) FILTER (WHERE NOT COALESCE(mi.is_verified, false)) AS u
    FROM public.menu_items mi
    WHERE CASE WHEN p.fr THEN mi.place_id IS NULL AND mi.restaurant_name = p.rname
               ELSE p.pid IS NOT NULL AND mi.place_id = p.pid END
  ) c ON TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public._menu_health_rows(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 2. The headline numbers ─────────────────────────────────────────────────
CREATE FUNCTION public.admin_report_menu_health_snapshot(p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL)
RETURNS TABLE (verified_count BIGINT, unverified_count BIGINT, restaurants_with_no_items_count BIGINT, restaurant_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT COALESCE(SUM(h.mh_verified), 0)::BIGINT,
         COALESCE(SUM(h.mh_unverified), 0)::BIGINT,
         (COUNT(*) FILTER (WHERE h.mh_verified + h.mh_unverified = 0))::BIGINT,
         COUNT(*)::BIGINT
  FROM public._menu_health_rows(p_state, p_city) h;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_menu_health_snapshot(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_menu_health_snapshot(TEXT, TEXT) TO authenticated;

-- ── 3. The table: restaurants with at least one item ────────────────────────
CREATE FUNCTION public.admin_report_menu_health_by_restaurant(
  p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  total_count      BIGINT,
  restaurant_id    UUID,
  restaurant_name  TEXT,
  verified_count   BIGINT,
  unverified_count BIGINT,
  place_id         TEXT,
  address          TEXT,
  is_franchise     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT COUNT(*) OVER ()::BIGINT, h.mh_id, h.mh_name, h.mh_verified, h.mh_unverified, h.mh_place_id, h.mh_address, h.mh_franchise
  FROM public._menu_health_rows(p_state, p_city) h
  WHERE h.mh_verified + h.mh_unverified > 0
  ORDER BY lower(h.mh_name), h.mh_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

-- ── 4. The restaurants with no items at all ─────────────────────────────────
CREATE FUNCTION public.admin_report_restaurants_no_menu_items(
  p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  total_count     BIGINT,
  restaurant_id   UUID,
  restaurant_name TEXT,
  status          TEXT,
  claimed_at      TIMESTAMPTZ,
  place_id        TEXT,
  address         TEXT,
  is_franchise    BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT COUNT(*) OVER ()::BIGINT, h.mh_id, h.mh_name, h.mh_status, h.mh_claimed_at, h.mh_place_id, h.mh_address, h.mh_franchise
  FROM public._menu_health_rows(p_state, p_city) h
  WHERE h.mh_verified + h.mh_unverified = 0
  ORDER BY h.mh_claimed_at ASC NULLS LAST, lower(h.mh_name), h.mh_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_restaurants_no_menu_items(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_restaurants_no_menu_items(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

-- ── 5. The regions and cities for the filter ────────────────────────────────
-- One row per region and city that has claimed (approved or pending) restaurants; a NULL state means the address has no readable state.
CREATE OR REPLACE FUNCTION public.admin_menu_health_locations()
RETURNS TABLE (state TEXT, city TEXT, restaurant_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT public.address_state(r.address), public.address_city(r.address), COUNT(*)::BIGINT
  FROM public.restaurants r
  WHERE r.status IN ('approved', 'pending')
  GROUP BY public.address_state(r.address), public.address_city(r.address)
  ORDER BY 1 NULLS LAST, 2 NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_menu_health_locations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_menu_health_locations() TO authenticated;

NOTIFY pgrst, 'reload schema';

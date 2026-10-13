-- Menu Data Health: include the restaurants found by City Imports, and filter by source.
--
-- Migration 137 limited the report to claimed restaurants, so a region full of city-imported restaurants showed just the few that
-- were claimed. The report now covers claimed restaurants (approved or pending) PLUS restaurants a City Imports search queued or
-- that already had a menu. A restaurant that is both is listed once, as claimed. Cached restaurants (customers' Google searches)
-- are not included. Counting is unchanged (the restaurant's own place; a franchise's shared name-keyed menu; unknown = unverified).
--
-- A city-imported restaurant's city and state are the ones entered on City Imports; a claimed one's are read from its address.
-- A city-imported restaurant has no owner, so its restaurant_id is NULL; use place_id to tell rows apart. Its read_status is what the
-- menu crawler did (pending / crawling / done / no_items / error / needs_attention), or NULL when it already had a menu.
--
--   p_source   NULL or '' = both; 'claimed'; 'city'
--
--   _menu_health_scope()                      every restaurant in the report with its city, state and source (internal)
--   _menu_health_rows(state, city, source)    that scope filtered, with verified / unverified counts (internal)
--   admin_report_menu_health_snapshot         the headline numbers for the filter
--   admin_report_menu_health_by_restaurant    the table, restaurants with at least one item, a page at a time
--   admin_report_restaurants_no_menu_items    restaurants with no items, a page at a time
--   admin_menu_health_locations               the regions and cities for the pickers (both sources)
--
-- Safe to re-run.

DROP FUNCTION IF EXISTS public._menu_health_rows(TEXT, TEXT);
DROP FUNCTION IF EXISTS public._menu_health_rows(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_report_menu_health_snapshot(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_report_menu_health_snapshot(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.admin_report_restaurants_no_menu_items(TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.admin_report_restaurants_no_menu_items(TEXT, TEXT, INTEGER, INTEGER, TEXT);

-- ── 1. Who is in the report ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._menu_health_scope()
RETURNS TABLE (
  sc_id        UUID,
  sc_name      TEXT,
  sc_status    TEXT,
  sc_since     TIMESTAMPTZ,
  sc_place_id  TEXT,
  sc_address   TEXT,
  sc_franchise BOOLEAN,
  sc_city      TEXT,
  sc_state     TEXT,
  sc_source    TEXT,
  sc_read      TEXT
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
  claimed AS (
    SELECT r.id AS rid, r.name AS rname, r.status::TEXT AS rstatus, r.claimed_at AS rsince, r.google_place_id AS pid,
           r.address AS raddress,
           (public.normalize_restaurant_name(r.name) IN (SELECT n FROM chain_norms)) AS fr
    FROM public.restaurants r
    WHERE r.status IN ('approved', 'pending')
  ),
  city_all AS (
    SELECT DISTINCT ON (cp.place_id) cp.place_id AS pid, cp.name AS cname, cp.address AS caddress, cp.found_at AS cfound,
           NULLIF(btrim(cc.name), '') AS ccity, public.normalize_state(cc.region) AS cstate, m.status AS cread
    FROM public.city_places cp
    JOIN public.crawl_cities cc ON cc.id = cp.city_id
    LEFT JOIN public.place_menu_crawl m ON m.place_id = cp.place_id
    WHERE cp.outcome IN ('queued', 'has_menu')
      AND NOT EXISTS (SELECT 1 FROM claimed c WHERE c.pid = cp.place_id)
    ORDER BY cp.place_id, cp.found_at DESC
  )
  SELECT c.rid, c.rname, c.rstatus, c.rsince, c.pid, c.raddress, c.fr,
         public.address_city(c.raddress), public.address_state(c.raddress), 'claimed'::TEXT, NULL::TEXT
  FROM claimed c
  UNION ALL
  SELECT NULL::UUID, x.cname, NULL::TEXT, x.cfound, x.pid, x.caddress, FALSE,
         x.ccity, x.cstate, 'city'::TEXT, x.cread
  FROM city_all x;
END;
$$;

REVOKE ALL ON FUNCTION public._menu_health_scope() FROM PUBLIC, anon, authenticated;

-- ── 2. The scope with counts, filtered ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._menu_health_rows(p_state TEXT, p_city TEXT, p_source TEXT)
RETURNS TABLE (
  mh_id         UUID,
  mh_name       TEXT,
  mh_status     TEXT,
  mh_since      TIMESTAMPTZ,
  mh_place_id   TEXT,
  mh_address    TEXT,
  mh_franchise  BOOLEAN,
  mh_city       TEXT,
  mh_state      TEXT,
  mh_source     TEXT,
  mh_read       TEXT,
  mh_verified   BIGINT,
  mh_unverified BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT s.* FROM public._menu_health_scope() s
    WHERE (COALESCE(btrim(p_state), '') = ''
           OR (btrim(p_state) = '__none__' AND s.sc_state IS NULL)
           OR lower(s.sc_state) = lower(btrim(p_state)))
      AND (COALESCE(btrim(p_city), '') = '' OR lower(btrim(s.sc_city)) = lower(btrim(p_city)))
      AND (COALESCE(btrim(p_source), '') = '' OR s.sc_source = lower(btrim(p_source)))
  )
  SELECT p.sc_id, p.sc_name, p.sc_status, p.sc_since, p.sc_place_id, p.sc_address, p.sc_franchise, p.sc_city, p.sc_state,
         p.sc_source, p.sc_read,
         COALESCE(c.v, 0)::BIGINT, COALESCE(c.u, 0)::BIGINT
  FROM picked p
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE COALESCE(mi.is_verified, false)) AS v,
           COUNT(*) FILTER (WHERE NOT COALESCE(mi.is_verified, false)) AS u
    FROM public.menu_items mi
    WHERE CASE WHEN p.sc_franchise THEN mi.place_id IS NULL AND mi.restaurant_name = p.sc_name
               ELSE p.sc_place_id IS NOT NULL AND mi.place_id = p.sc_place_id END
  ) c ON TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public._menu_health_rows(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 3. The headline numbers ─────────────────────────────────────────────────
CREATE FUNCTION public.admin_report_menu_health_snapshot(p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_source TEXT DEFAULT NULL)
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
  FROM public._menu_health_rows(p_state, p_city, p_source) h;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_menu_health_snapshot(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_menu_health_snapshot(TEXT, TEXT, TEXT) TO authenticated;

-- ── 4. The table: restaurants with at least one item ────────────────────────
CREATE FUNCTION public.admin_report_menu_health_by_restaurant(
  p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0, p_source TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_count      BIGINT,
  restaurant_id    UUID,
  restaurant_name  TEXT,
  verified_count   BIGINT,
  unverified_count BIGINT,
  place_id         TEXT,
  address          TEXT,
  is_franchise     BOOLEAN,
  source           TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT COUNT(*) OVER ()::BIGINT, h.mh_id, h.mh_name, h.mh_verified, h.mh_unverified, h.mh_place_id, h.mh_address, h.mh_franchise, h.mh_source
  FROM public._menu_health_rows(p_state, p_city, p_source) h
  WHERE h.mh_verified + h.mh_unverified > 0
  ORDER BY lower(h.mh_name), h.mh_place_id, h.mh_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT) TO authenticated;

-- ── 5. The restaurants with no items at all ─────────────────────────────────
CREATE FUNCTION public.admin_report_restaurants_no_menu_items(
  p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0, p_source TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_count     BIGINT,
  restaurant_id   UUID,
  restaurant_name TEXT,
  status          TEXT,
  claimed_at      TIMESTAMPTZ,
  place_id        TEXT,
  address         TEXT,
  is_franchise    BOOLEAN,
  source          TEXT,
  read_status     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT COUNT(*) OVER ()::BIGINT, h.mh_id, h.mh_name, h.mh_status, h.mh_since, h.mh_place_id, h.mh_address, h.mh_franchise, h.mh_source, h.mh_read
  FROM public._menu_health_rows(p_state, p_city, p_source) h
  WHERE h.mh_verified + h.mh_unverified = 0
  ORDER BY h.mh_since ASC NULLS LAST, lower(h.mh_name), h.mh_place_id, h.mh_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_restaurants_no_menu_items(TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_restaurants_no_menu_items(TEXT, TEXT, INTEGER, INTEGER, TEXT) TO authenticated;

-- ── 6. The regions and cities for the filter ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_menu_health_locations()
RETURNS TABLE (state TEXT, city TEXT, restaurant_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT s.sc_state, s.sc_city, COUNT(*)::BIGINT
  FROM public._menu_health_scope() s
  GROUP BY s.sc_state, s.sc_city
  ORDER BY 1 NULLS LAST, 2 NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_menu_health_locations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_menu_health_locations() TO authenticated;

NOTIFY pgrst, 'reload schema';

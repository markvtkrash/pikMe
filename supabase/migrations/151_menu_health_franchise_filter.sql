-- Menu Data Health: filter by franchise vs independent, alongside the existing region/city/source filters.
--
--   p_franchise   NULL or '' = both; 'franchise'; 'independent'
--
-- Every restaurant already carries sc_franchise/mh_franchise (is_franchise on the two table
-- reports) -- this just lets the admin filter on it too, the same way p_source already works.
--
-- Also fixes a bug found while testing this: _menu_health_scope() (migration 138) hardcoded
-- FALSE for every city-imported restaurant's franchise flag, never actually checking its name
-- against the franchise list the way a claimed restaurant's flag already was. A city-imported
-- franchise location (e.g. a chain found by City Imports before anyone claimed it) was always
-- shown -- and, worse, miscounted -- as independent. Its items are stored name-keyed like any
-- other franchise's, so the old hardcoded-FALSE flag also made the lateral join below look for
-- them by place instead of by name, silently losing them from every count.
--
-- Safe to re-run.

DROP FUNCTION IF EXISTS public._menu_health_rows(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_report_menu_health_snapshot(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.admin_report_restaurants_no_menu_items(TEXT, TEXT, INTEGER, INTEGER, TEXT);

-- ── 0. Fix: a city-imported restaurant's franchise flag was never actually computed ────────
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
           NULLIF(btrim(cc.name), '') AS ccity, public.normalize_state(cc.region) AS cstate, m.status AS cread,
           (public.normalize_restaurant_name(cp.name) IN (SELECT n FROM chain_norms)) AS cfr
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
  SELECT NULL::UUID, x.cname, NULL::TEXT, x.cfound, x.pid, x.caddress, x.cfr,
         x.ccity, x.cstate, 'city'::TEXT, x.cread
  FROM city_all x;
END;
$$;

REVOKE ALL ON FUNCTION public._menu_health_scope() FROM PUBLIC, anon, authenticated;

-- ── 1. The scope with counts, filtered ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._menu_health_rows(p_state TEXT, p_city TEXT, p_source TEXT, p_franchise TEXT DEFAULT NULL)
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
      AND (COALESCE(btrim(p_franchise), '') = ''
           OR (lower(btrim(p_franchise)) = 'franchise' AND s.sc_franchise)
           OR (lower(btrim(p_franchise)) = 'independent' AND NOT s.sc_franchise))
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

REVOKE ALL ON FUNCTION public._menu_health_rows(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 2. The headline numbers ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_menu_health_snapshot(
  p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_source TEXT DEFAULT NULL, p_franchise TEXT DEFAULT NULL
)
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
  FROM public._menu_health_rows(p_state, p_city, p_source, p_franchise) h;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_menu_health_snapshot(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_menu_health_snapshot(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ── 3. The table: restaurants with at least one item ────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_menu_health_by_restaurant(
  p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0,
  p_source TEXT DEFAULT NULL, p_franchise TEXT DEFAULT NULL
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
  FROM public._menu_health_rows(p_state, p_city, p_source, p_franchise) h
  WHERE h.mh_verified + h.mh_unverified > 0
  ORDER BY lower(h.mh_name), h.mh_place_id, h.mh_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;

-- ── 4. The restaurants with no items at all ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_restaurants_no_menu_items(
  p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0,
  p_source TEXT DEFAULT NULL, p_franchise TEXT DEFAULT NULL
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
  FROM public._menu_health_rows(p_state, p_city, p_source, p_franchise) h
  WHERE h.mh_verified + h.mh_unverified = 0
  ORDER BY h.mh_since ASC NULLS LAST, lower(h.mh_name), h.mh_place_id, h.mh_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_restaurants_no_menu_items(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_restaurants_no_menu_items(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

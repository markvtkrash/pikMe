-- Menu Data Health: search by restaurant name, alongside the existing region/city/source/franchise filters.
--
--   p_search   NULL or '' = no search; otherwise a case-insensitive substring match on the restaurant name.
--
-- Added as the LAST parameter with a default on every function below, so every existing positional call
-- (the client, the other reports' tests) keeps working unchanged.
--
-- Safe to re-run.

DROP FUNCTION IF EXISTS public._menu_health_rows(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_report_menu_health_snapshot(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN);

-- ── 1. The scope with counts, filtered ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._menu_health_rows(
  p_state TEXT, p_city TEXT, p_source TEXT, p_franchise TEXT DEFAULT NULL, p_search TEXT DEFAULT NULL
)
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
      AND (COALESCE(btrim(p_search), '') = '' OR s.sc_name ILIKE '%' || btrim(p_search) || '%')
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

REVOKE ALL ON FUNCTION public._menu_health_rows(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ── 2. The headline numbers ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_menu_health_snapshot(
  p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_source TEXT DEFAULT NULL, p_franchise TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL
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
  FROM public._menu_health_rows(p_state, p_city, p_source, p_franchise, p_search) h;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_menu_health_snapshot(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_menu_health_snapshot(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ── 3. The restaurant table (p_no_items: migration 152) ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_menu_health_by_restaurant(
  p_state TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0,
  p_source TEXT DEFAULT NULL, p_franchise TEXT DEFAULT NULL, p_no_items BOOLEAN DEFAULT FALSE, p_search TEXT DEFAULT NULL
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
  FROM public._menu_health_rows(p_state, p_city, p_source, p_franchise, p_search) h
  WHERE CASE WHEN COALESCE(p_no_items, FALSE) THEN h.mh_verified + h.mh_unverified = 0 ELSE h.mh_verified + h.mh_unverified > 0 END
  ORDER BY (CASE WHEN COALESCE(p_no_items, FALSE) THEN h.mh_since END) ASC NULLS LAST, lower(h.mh_name), h.mh_place_id, h.mh_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_menu_health_by_restaurant(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

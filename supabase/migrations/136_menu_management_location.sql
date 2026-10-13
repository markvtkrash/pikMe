-- Menu Management: filter by region (state) and city, and list the restaurants found by City Imports.
--
--   address_city / address_state   read the city and state out of a Google formatted US address such as
--                                  "1 Main St, Austin, TX 78701, USA" (also "Austin, TX, USA" and "... TX 78701" with no country).
--                                  NULL when the address does not end in a state: other countries, or no address.
--   normalize_state                a state typed as a full name ("Texas") becomes its code ("TX"); a two-letter code is upper-cased;
--                                  anything else is kept as typed (trimmed).
--   admin_list_restaurants_with_menu_counts
--                                  as migration 108 plus two columns at the end, city and state, and a new source 'city': the
--                                  restaurants a City Imports search queued (or that already had a menu), unless they are already
--                                  listed as claimed or cached. Their city and state are the ones entered on City Imports. Other
--                                  rows get them from the address (a cached restaurant falls back to its city column). Franchise
--                                  rows (one per name, one shared menu) have no city or state.
--
-- Safe to re-run.

-- ── 1. Reading a US address ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._address_parts(p_address TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_parts TEXT[];
  v_n     INTEGER;
  v_m     TEXT[];
  v_city  TEXT;
BEGIN
  IF p_address IS NULL OR btrim(p_address) = '' THEN RETURN NULL; END IF;
  SELECT array_agg(btrim(t.part) ORDER BY t.ord) INTO v_parts
    FROM unnest(string_to_array(p_address, ',')) WITH ORDINALITY AS t(part, ord);
  v_n := COALESCE(array_length(v_parts, 1), 0);
  IF v_n > 0 AND upper(v_parts[v_n]) IN ('USA', 'US', 'UNITED STATES', 'UNITED STATES OF AMERICA') THEN v_n := v_n - 1; END IF;
  IF v_n < 2 THEN RETURN NULL; END IF;
  v_m := regexp_match(v_parts[v_n], '^([A-Za-z]{2})(\s+[0-9]{5}(-[0-9]{4})?)?$');
  IF v_m IS NULL THEN RETURN NULL; END IF;
  v_city := NULLIF(v_parts[v_n - 1], '');
  IF v_city ~ '[0-9]' THEN v_city := NULL; END IF;     -- a street, not a city
  RETURN ARRAY[v_city, upper(v_m[1])];
END;
$$;

CREATE OR REPLACE FUNCTION public.address_city(p_address TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT (public._address_parts(p_address))[1]; $$;

CREATE OR REPLACE FUNCTION public.address_state(p_address TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT (public._address_parts(p_address))[2]; $$;

-- ── 2. A state typed as a name ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_state(p_state TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_state IS NULL OR btrim(p_state) = '' THEN NULL
    WHEN char_length(btrim(p_state)) = 2 THEN upper(btrim(p_state))
    ELSE COALESCE(
      (SELECT v.code FROM (VALUES
        ('ALABAMA','AL'),('ALASKA','AK'),('ARIZONA','AZ'),('ARKANSAS','AR'),('CALIFORNIA','CA'),('COLORADO','CO'),
        ('CONNECTICUT','CT'),('DELAWARE','DE'),('DISTRICT OF COLUMBIA','DC'),('FLORIDA','FL'),('GEORGIA','GA'),('HAWAII','HI'),
        ('IDAHO','ID'),('ILLINOIS','IL'),('INDIANA','IN'),('IOWA','IA'),('KANSAS','KS'),('KENTUCKY','KY'),('LOUISIANA','LA'),
        ('MAINE','ME'),('MARYLAND','MD'),('MASSACHUSETTS','MA'),('MICHIGAN','MI'),('MINNESOTA','MN'),('MISSISSIPPI','MS'),
        ('MISSOURI','MO'),('MONTANA','MT'),('NEBRASKA','NE'),('NEVADA','NV'),('NEW HAMPSHIRE','NH'),('NEW JERSEY','NJ'),
        ('NEW MEXICO','NM'),('NEW YORK','NY'),('NORTH CAROLINA','NC'),('NORTH DAKOTA','ND'),('OHIO','OH'),('OKLAHOMA','OK'),
        ('OREGON','OR'),('PENNSYLVANIA','PA'),('RHODE ISLAND','RI'),('SOUTH CAROLINA','SC'),('SOUTH DAKOTA','SD'),
        ('TENNESSEE','TN'),('TEXAS','TX'),('UTAH','UT'),('VERMONT','VT'),('VIRGINIA','VA'),('WASHINGTON','WA'),
        ('WEST VIRGINIA','WV'),('WISCONSIN','WI'),('WYOMING','WY')
      ) AS v(state_name, code) WHERE v.state_name = upper(regexp_replace(btrim(p_state), '\s+', ' ', 'g'))),
      btrim(p_state))
  END;
$$;

-- ── 3. The list ─────────────────────────────────────────────────────────────
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
  is_franchise             BOOLEAN,
  city                     TEXT,
  state                    TEXT
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
           COALESCE(public.address_city(cr.address), NULLIF(btrim(cr.city), '')) AS ccity,
           public.address_state(cr.address) AS cstate,
           (public.normalize_restaurant_name(cr.name) IN (SELECT n FROM chain_norms)) AS fr
    FROM public.cached_restaurants cr
    WHERE NOT EXISTS (SELECT 1 FROM claimed c WHERE c.google_place_id = cr.place_id)
  ),
  city_all AS (
    -- Restaurants a City Imports search queued (or that already had a menu), not already listed as claimed or cached.
    SELECT DISTINCT ON (cp.place_id) cp.place_id AS pid, cp.name, cp.address,
           NULLIF(btrim(cc.name), '') AS ccity, public.normalize_state(cc.region) AS cstate
    FROM public.city_places cp
    JOIN public.crawl_cities cc ON cc.id = cp.city_id
    WHERE cp.outcome IN ('queued', 'has_menu')
      AND NOT EXISTS (SELECT 1 FROM claimed c WHERE c.google_place_id = cp.place_id)
      AND NOT EXISTS (SELECT 1 FROM public.cached_restaurants x WHERE x.place_id = cp.place_id)
    ORDER BY cp.place_id, cp.found_at DESC
  ),
  combined AS (
    -- claimed: one row each
    SELECT c.name, c.address, 'claimed'::TEXT AS src, c.id AS rid, c.rstatus AS rst,
           c.business_name AS biz, c.owner_email AS oemail, 1::BIGINT AS locs, FALSE AS shares,
           c.google_place_id AS pid, c.fr,
           public.address_city(c.address) AS rcity, public.address_state(c.address) AS rstate
    FROM claimed c
    UNION ALL
    -- unclaimed franchise locations: one row per name (one shared menu), so no single city
    SELECT ca.name, MIN(ca.address), 'cached'::TEXT, NULL::UUID, NULL::TEXT,
           NULL::TEXT, NULL::TEXT, COUNT(*)::BIGINT,
           EXISTS (SELECT 1 FROM claimed c2 WHERE c2.name = ca.name),
           NULL::TEXT, TRUE, NULL::TEXT, NULL::TEXT
    FROM cached_all ca
    WHERE ca.fr
    GROUP BY ca.name
    UNION ALL
    -- unclaimed independents: one row per location (each has its own menu)
    SELECT ca.name, ca.address, 'cached'::TEXT, NULL::UUID, NULL::TEXT,
           NULL::TEXT, NULL::TEXT, 1::BIGINT, FALSE, ca.pid, FALSE, ca.ccity, ca.cstate
    FROM cached_all ca
    WHERE NOT ca.fr
    UNION ALL
    -- found by City Imports
    SELECT ci.name, ci.address, 'city'::TEXT, NULL::UUID, NULL::TEXT,
           NULL::TEXT, NULL::TEXT, 1::BIGINT, FALSE, ci.pid, FALSE, ci.ccity, ci.cstate
    FROM city_all ci
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
    cb.fr,
    cb.rcity,
    cb.rstate
  FROM combined cb
  LEFT JOIN name_counts nc ON nc.rname = cb.name
  LEFT JOIN place_counts pc ON pc.pid = cb.pid
  ORDER BY cb.name, cb.src, cb.address;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_restaurants_with_menu_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_restaurants_with_menu_counts() TO authenticated;

NOTIFY pgrst, 'reload schema';

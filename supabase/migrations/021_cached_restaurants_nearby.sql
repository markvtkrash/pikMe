-- Migration: 021_cached_restaurants_nearby
-- Purpose: Fix the false-cache-miss bug in fetch-nearby-restaurants. The Edge
--          Function used to `SELECT ... LIMIT 50` filtered by time only, then
--          filter by distance in JS. Once the cache holds >50 rows spread across
--          locations, the 50 rows Postgres returned might exclude the ones near
--          the user -> false cache miss -> needless Google Places call.
--
--          This RPC does the geo filtering in SQL against the WHOLE table:
--          a cheap bounding-box prefilter (index-backed) narrows candidates,
--          then a precise haversine filter + ORDER BY distance returns only the
--          truly-nearest rows within radius. No PostGIS/earthdistance required.
-- Date: 2026-07-23

-- ── 1. Index to make the bounding-box prefilter cheap ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_cached_restaurants_lat_lng
  ON public.cached_restaurants (latitude, longitude);

-- ── 2. Location-aware cache read ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cached_restaurants_nearby(
  p_lat           DOUBLE PRECISION,
  p_lng           DOUBLE PRECISION,
  p_radius_meters DOUBLE PRECISION,
  p_max_age_hours DOUBLE PRECISION DEFAULT 168  -- 7-day TTL (Google Places cache policy)
)
RETURNS SETOF public.cached_restaurants AS $$
DECLARE
  -- Degrees of latitude per metre is ~constant (111320 m per degree).
  lat_delta DOUBLE PRECISION := p_radius_meters / 111320.0;
  -- Degrees of longitude per metre shrinks toward the poles; clamp cos() so we
  -- never divide by ~0 at extreme latitudes.
  lng_delta DOUBLE PRECISION :=
    p_radius_meters / (111320.0 * GREATEST(COS(RADIANS(p_lat)), 0.000001));
BEGIN
  RETURN QUERY
  SELECT r.*
  FROM public.cached_restaurants r
  WHERE r.cached_at > NOW() - (p_max_age_hours * INTERVAL '1 hour')
    -- Cheap bounding-box prefilter (uses idx_cached_restaurants_lat_lng).
    AND r.latitude  BETWEEN p_lat - lat_delta AND p_lat + lat_delta
    AND r.longitude BETWEEN p_lng - lng_delta AND p_lng + lng_delta
    -- Precise circular-radius filter (haversine, metres).
    AND 6371000 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(r.latitude  - p_lat) / 2), 2) +
          COS(RADIANS(p_lat)) * COS(RADIANS(r.latitude)) *
          POWER(SIN(RADIANS(r.longitude - p_lng) / 2), 2)
        )) <= p_radius_meters
  ORDER BY 6371000 * 2 * ASIN(SQRT(
             POWER(SIN(RADIANS(r.latitude  - p_lat) / 2), 2) +
             COS(RADIANS(p_lat)) * COS(RADIANS(r.latitude)) *
             POWER(SIN(RADIANS(r.longitude - p_lng) / 2), 2)
           )) ASC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Read path is invoked by the Edge Function via the service role; grant to
-- authenticated too for parity with the rest of the cache surface.
GRANT EXECUTE ON FUNCTION public.get_cached_restaurants_nearby(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
) TO authenticated;

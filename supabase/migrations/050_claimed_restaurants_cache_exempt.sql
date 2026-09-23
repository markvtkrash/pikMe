-- Migration: 050_claimed_restaurants_cache_exempt
-- Purpose: Step 2 of the two-step Google Places cost fix. A claimed
--          restaurant's cached_restaurants row used to expire on the same
--          flat 7-day TTL as every other cached restaurant, so once it aged
--          out, fetch-nearby-restaurants' backfill loop would need a fresh
--          Google Place Details call to rediscover it -- recurring roughly
--          weekly for any restaurant Google's own Nearby Search doesn't rank
--          well on its own. Claimed restaurants are a small, known set (owner
--          count grows far slower than consumer search volume), so once one
--          is cached, it should never need rediscovering: exempt any row
--          whose place_id belongs to a claimed restaurant from the age
--          filter entirely.
-- Date: 2026-09-22

CREATE OR REPLACE FUNCTION public.get_cached_restaurants_nearby(
  p_lat           DOUBLE PRECISION,
  p_lng           DOUBLE PRECISION,
  p_radius_meters DOUBLE PRECISION,
  p_max_age_hours DOUBLE PRECISION DEFAULT 168  -- 7-day TTL (Google Places cache policy)
)
RETURNS SETOF public.cached_restaurants AS $$
DECLARE
  lat_delta DOUBLE PRECISION := p_radius_meters / 111320.0;
  lng_delta DOUBLE PRECISION :=
    p_radius_meters / (111320.0 * GREATEST(COS(RADIANS(p_lat)), 0.000001));
BEGIN
  RETURN QUERY
  SELECT r.*
  FROM public.cached_restaurants r
  WHERE (
      r.cached_at > NOW() - (p_max_age_hours * INTERVAL '1 hour')
      OR EXISTS (
        SELECT 1 FROM public.restaurants cr WHERE cr.google_place_id = r.place_id
      )
    )
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

GRANT EXECUTE ON FUNCTION public.get_cached_restaurants_nearby(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION
) TO authenticated;

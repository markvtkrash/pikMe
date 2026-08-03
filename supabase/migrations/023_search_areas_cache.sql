-- Migration: 023_search_areas_cache
-- Purpose: Fix false cache hits in fetch-nearby-restaurants. The old check
-- ("does any cached restaurant happen to fall within radius of this point")
-- could be satisfied by as little as ONE coincidentally-cached restaurant left
-- over from a completely unrelated earlier search — meaning a brand new
-- location could silently short-circuit to a single stray result instead of
-- ever calling Google. This tracks actual search *events* separately from the
-- restaurant data itself, so the cache-hit check answers "has this area
-- genuinely been searched before" instead of guessing from result density.
-- Date: 2026-07-26

CREATE TABLE IF NOT EXISTS public.search_areas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  latitude       DOUBLE PRECISION NOT NULL,
  longitude      DOUBLE PRECISION NOT NULL,
  radius_meters  DOUBLE PRECISION NOT NULL,
  searched_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_areas_lat_lng ON public.search_areas (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_search_areas_searched_at ON public.search_areas (searched_at);

COMMENT ON TABLE public.search_areas IS 'One row per real Google Places API call made by fetch-nearby-restaurants. Used to answer "has this area actually been searched" instead of inferring it from cached_restaurants row density, which caused false cache hits.';

-- ── is_area_covered: has a prior search already guaranteed data for this point? ─
-- A search centered at (s.latitude, s.longitude) with radius s.radius_meters
-- fully covers a NEW request for radius p_radius_meters around (p_lat, p_lng)
-- only if distance(search_center, point) + p_radius_meters <= s.radius_meters
-- (the worst-case point in the new request's circle must still fall inside the
-- old search's circle). p_tolerance_meters relaxes that strict geometry so
-- nearby-but-not-identical requests can still share coverage instead of each
-- demanding its own Google call — trading a small amount of strictness at the
-- fringe for far fewer duplicate API calls. Since this app always requests the
-- same MAX_FETCH_RADIUS_METERS, p_radius_meters and s.radius_meters are
-- normally equal, so in practice this reduces to "was there a full search
-- within ~p_tolerance_meters of here."
CREATE OR REPLACE FUNCTION public.is_area_covered(
  p_lat              DOUBLE PRECISION,
  p_lng              DOUBLE PRECISION,
  p_radius_meters    DOUBLE PRECISION,
  p_max_age_hours    DOUBLE PRECISION DEFAULT 168,
  p_tolerance_meters DOUBLE PRECISION DEFAULT 1500
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_covered BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.search_areas s
    WHERE s.searched_at > NOW() - (p_max_age_hours * INTERVAL '1 hour')
      AND 6371000 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(s.latitude - p_lat) / 2), 2) +
            COS(RADIANS(p_lat)) * COS(RADIANS(s.latitude)) *
            POWER(SIN(RADIANS(s.longitude - p_lng) / 2), 2)
          )) <= (s.radius_meters - p_radius_meters + p_tolerance_meters)
  ) INTO v_covered;

  RETURN v_covered;
END;
$$;

-- ── record_search_area: log that a real Google search was just performed ───────
CREATE OR REPLACE FUNCTION public.record_search_area(
  p_lat           DOUBLE PRECISION,
  p_lng           DOUBLE PRECISION,
  p_radius_meters DOUBLE PRECISION
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.search_areas (latitude, longitude, radius_meters)
  VALUES (p_lat, p_lng, p_radius_meters);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_area_covered(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_search_area(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- Migration: 031_fix_cached_restaurants_photo_refresh
-- Purpose: upsert_restaurants (migration 018) never updated photo_reference on
--          conflict, so once a restaurant was cached its photo stayed frozen
--          at whatever it got on the very first insert -- including NULL, if
--          Google returned no photo on that first pass. Re-searching the same
--          area later (a fresh Google call after the 7-day TTL, or a slightly
--          different radius) could return a real photo for that place, but
--          the cache would still serve the stale/missing one.
-- Date: 2026-09-13

CREATE OR REPLACE FUNCTION public.upsert_restaurants(p_restaurants JSONB)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.cached_restaurants (
    place_id, name, latitude, longitude, address, city,
    rating, price_level, cuisine_types, photo_reference, opening_hours, open_now, cached_at
  )
  SELECT
    r->>'placeId', r->>'name',
    (r->>'latitude')::DOUBLE PRECISION, (r->>'longitude')::DOUBLE PRECISION,
    r->>'address', r->>'city',
    (r->>'rating')::NUMERIC, (r->>'priceLevel')::SMALLINT,
    ARRAY(SELECT jsonb_array_elements_text(r->'cuisineTypes')),
    r->>'photoReference', r->'openingHours', (r->>'openNow')::BOOLEAN, NOW()
  FROM jsonb_array_elements(p_restaurants) AS r
  ON CONFLICT (place_id) DO UPDATE SET
    rating          = EXCLUDED.rating,
    photo_reference = EXCLUDED.photo_reference,
    opening_hours   = EXCLUDED.opening_hours,
    open_now        = EXCLUDED.open_now,
    cached_at       = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Migration: 041_fix_upsert_restaurants_address_refresh
-- Purpose: upsert_restaurants' ON CONFLICT clause (migration 018, partially
--          fixed for photo_reference in migration 031) still never refreshed
--          address, name, latitude, longitude, city, cuisine_types, or
--          price_level -- so once a restaurant was cached, its address stayed
--          frozen at whatever it got on the very first insert, including
--          blank, if Google's `vicinity` was empty on that first pass (e.g.
--          the owner claim flow's nearby search). A later search that would
--          have returned a real address could never overwrite the stale
--          cached row. Now every field is refreshed on conflict.
-- Date: 2026-09-21

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
    name            = EXCLUDED.name,
    latitude        = EXCLUDED.latitude,
    longitude       = EXCLUDED.longitude,
    address         = EXCLUDED.address,
    city            = EXCLUDED.city,
    rating          = EXCLUDED.rating,
    price_level     = EXCLUDED.price_level,
    cuisine_types   = EXCLUDED.cuisine_types,
    photo_reference = EXCLUDED.photo_reference,
    opening_hours   = EXCLUDED.opening_hours,
    open_now        = EXCLUDED.open_now,
    cached_at       = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

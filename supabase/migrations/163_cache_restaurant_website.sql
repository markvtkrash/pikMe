-- Cache the Google website for each restaurant.
--
-- fetch-nearby-restaurants now asks Google for websiteUri (same billing tier as the rating and opening hours it already asks for) and
-- passes it to upsert_restaurants as r->>'website'. It is stored in cached_restaurants.website (migration 018).
--
-- As migration 041, plus website. A caller that sends no website (the owner claim, relocation, backfill) keeps the stored one:
-- only a non-blank website replaces it.
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.upsert_restaurants(p_restaurants JSONB)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.cached_restaurants (
    place_id, name, latitude, longitude, address, city,
    rating, price_level, cuisine_types, photo_reference, opening_hours, open_now, website, cached_at
  )
  SELECT
    r->>'placeId', r->>'name',
    (r->>'latitude')::DOUBLE PRECISION, (r->>'longitude')::DOUBLE PRECISION,
    r->>'address', r->>'city',
    (r->>'rating')::NUMERIC, (r->>'priceLevel')::SMALLINT,
    ARRAY(SELECT jsonb_array_elements_text(r->'cuisineTypes')),
    r->>'photoReference', r->'openingHours', (r->>'openNow')::BOOLEAN,
    LEFT(NULLIF(btrim(r->>'website'), ''), 2000), NOW()
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
    website         = COALESCE(EXCLUDED.website, public.cached_restaurants.website),
    cached_at       = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';

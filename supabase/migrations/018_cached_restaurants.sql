-- Migration: 018_cached_restaurants
-- Purpose: Resolve the name collision between the customer restaurant cache and
--          the owner-claimed restaurants table (migration 007). The customer
--          cache moves to its own table `cached_restaurants`; the owner-claimed
--          `restaurants` table is left untouched.
-- Date: 2026-06-27

-- ── 1. Dedicated customer cache table (mirrors the original restaurants schema) ──
CREATE TABLE IF NOT EXISTS public.cached_restaurants (
  place_id        TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  address         TEXT,
  city            TEXT,
  rating          NUMERIC(2,1),
  price_level     SMALLINT,
  cuisine_types   TEXT[],
  photo_reference TEXT,
  opening_hours   JSONB,
  open_now        BOOLEAN,
  phone_number    TEXT,
  website         TEXT,
  cached_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cached_restaurants_cached_at
  ON public.cached_restaurants (cached_at);

-- Shared, non-sensitive cache. Written only via SECURITY DEFINER RPCs / service role.
GRANT SELECT ON public.cached_restaurants TO authenticated;

-- ── 2. Repoint saved_restaurants FK to the new cache table ──────────────────────
DO $$
DECLARE
  c record;
BEGIN
  IF to_regclass('public.saved_restaurants') IS NULL THEN
    RETURN;
  END IF;

  -- Drop any foreign key on saved_restaurants that points at public.restaurants
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.saved_restaurants'::regclass
      AND contype = 'f'
      AND confrelid = 'public.restaurants'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.saved_restaurants DROP CONSTRAINT %I', c.conname);
  END LOOP;

  -- Add a FK to cached_restaurants if one does not already exist.
  -- NOT VALID so any pre-existing saved rows without a cached row don't block;
  -- new saves are checked (the client upserts the cache row before saving).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.saved_restaurants'::regclass
      AND contype = 'f'
      AND confrelid = 'public.cached_restaurants'::regclass
  ) THEN
    ALTER TABLE public.saved_restaurants
      ADD CONSTRAINT saved_restaurants_place_id_cached_fkey
      FOREIGN KEY (place_id) REFERENCES public.cached_restaurants(place_id)
      NOT VALID;
  END IF;
END $$;

-- ── 3. Point the cache upsert at cached_restaurants ─────────────────────────────
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

-- ── 4. Point get_saved_items at cached_restaurants ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_saved_items()
RETURNS JSONB AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  RETURN jsonb_build_object(
    'restaurants', COALESCE(
      (SELECT jsonb_agg(row_to_json(r.*) ORDER BY sr.saved_at DESC)
       FROM public.saved_restaurants sr
       LEFT JOIN public.cached_restaurants r ON r.place_id = sr.place_id
       WHERE sr.user_id = v_user_id),
      '[]'::JSONB
    ),
    'menuItems', COALESCE(
      (SELECT jsonb_agg(row_to_json(m.*) ORDER BY sm.saved_at DESC)
       FROM public.saved_menu_items sm
       LEFT JOIN public.menu_items m ON m.item_id = sm.item_id
       WHERE sm.user_id = v_user_id),
      '[]'::JSONB
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

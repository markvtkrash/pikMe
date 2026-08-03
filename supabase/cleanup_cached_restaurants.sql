-- Cleanup script: Clear the customer restaurant-discovery cache (cached_restaurants)
-- Use this to force a fresh Google Places fetch when testing changes to
-- fetch-nearby-restaurants (radius, keyword, pagination, etc).
--
-- IMPORTANT: cached_restaurants.place_id is referenced by a foreign key from
-- saved_restaurants (a customer's favorited restaurants). That FK is NOT
-- CASCADE, so:
--   - A plain TRUNCATE fails outright if ANY row is referenced (see the error
--     you hit). TRUNCATE ... CASCADE "works" but also wipes every customer's
--     saved restaurants, which you almost certainly don't want.
--   - A DELETE only fails for the specific rows a customer has actually saved
--     — everything else deletes fine.
-- Run whichever section below fits what you're testing.

-- ─── RECOMMENDED: expire every row instead of deleting anything ────────────────
-- No FK issues at all (it's an UPDATE, not a DELETE) and nothing is lost —
-- every row just fails the 7-day TTL check in get_cached_restaurants_nearby on
-- the very next request, forcing a genuine cache miss -> fresh Google fetch,
-- which then naturally refreshes cached_at via upsert_restaurants anyway.
UPDATE public.cached_restaurants
SET cached_at = NOW() - INTERVAL '8 days';

-- ─── 0. See what's currently cached (useful before targeting a delete) ─────────
SELECT place_id, name, latitude, longitude, cached_at
FROM public.cached_restaurants
ORDER BY cached_at DESC;

-- ─── 1. Delete by name (quick, no coordinates needed) ──────────────────────────
DELETE FROM public.cached_restaurants
WHERE name ILIKE '%dunkin%';

-- ─── 2. Delete everything within a radius of a test location ──────────────────
-- Replace YOUR_LAT / YOUR_LNG / YOUR_RADIUS_METERS with real values before running.
DELETE FROM public.cached_restaurants
WHERE 6371000 * 2 * ASIN(SQRT(
  POWER(SIN(RADIANS(latitude - YOUR_LAT) / 2), 2) +
  COS(RADIANS(YOUR_LAT)) * COS(RADIANS(latitude)) *
  POWER(SIN(RADIANS(longitude - YOUR_LNG) / 2), 2)
)) <= YOUR_RADIUS_METERS;

-- ─── 3. Safe "clear almost everything" — every cache row NOT currently saved ───
-- Deletes all stale cache except rows a customer has actually favorited (those
-- are the only ones the FK would block anyway). This is the closest equivalent
-- to a full wipe without touching saved_restaurants.
DELETE FROM public.cached_restaurants
WHERE place_id NOT IN (
  SELECT place_id FROM public.saved_restaurants WHERE place_id IS NOT NULL
);

-- ─── 4. Verify ──────────────────────────────────────────────────────────────────
SELECT 'cached_restaurants' AS table_name, COUNT(*) AS rows_remaining
FROM public.cached_restaurants;

-- Migration: 159_restaurants_timezone
-- Purpose: Prerequisite for the pickup-ordering feature (see ORDERING-SYSTEM-PLAN.md): the
--          kiosk access link's default expiry ("midnight tonight") has to be computed in the
--          restaurant's own local time, not UTC -- UTC midnight lands mid-service for most US
--          timezones. There is currently no restaurant timezone stored anywhere; the existing
--          "Opens tomorrow"/"Closes in 17m" hours display (user/src/utils/hours.ts) is computed
--          against the customer's own device clock, not any server-known value, so it cannot be
--          reused server-side the way the ordering plan originally assumed.
--          An IANA zone name (e.g. 'America/Chicago'), not a fixed UTC offset, so it stays
--          correct across DST transitions automatically via Postgres's own tz database.
--          Nullable and not backfilled here: ordering only needs this for a restaurant that
--          opts in, so it is set per-restaurant when ordering is enabled for it (Phase 1 concern),
--          not retroactively guessed for every existing restaurant from its address.
-- Date: 2026-10-22

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS timezone TEXT;

COMMENT ON COLUMN public.restaurants.timezone IS
  'IANA timezone name (e.g. America/Chicago), not a fixed UTC offset. NULL until set -- added for the pickup-ordering feature''s kiosk link expiry; not backfilled for existing restaurants.';

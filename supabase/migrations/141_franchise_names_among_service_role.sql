-- fetch-nearby-restaurants runs as service_role and asks franchise_names_among which of the listed restaurants are franchises (migration 126), to apply the
-- admin's "Franchise Restaurants / Independent Restaurants" switches. Migration 126 revoked the function from PUBLIC and granted it only to anon and
-- authenticated, so service_role was refused. The edge function catches that error and, by design, shows EVERYTHING, so switching franchises off had no
-- effect (the log said: "could not apply the restaurant kind flags, showing everything").
--
-- This lets service_role call it. Run it before (or right after) migration 139, which gives service_role read access to app_config.
-- Safe to re-run.

GRANT EXECUTE ON FUNCTION public.franchise_names_among(TEXT[]) TO service_role;

NOTIFY pgrst, 'reload schema';

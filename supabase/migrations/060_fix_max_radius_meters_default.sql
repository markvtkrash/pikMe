-- Supersedes the original version of this migration (which just fixed the
-- stale 3000m default) — the key itself is now renamed from
-- 'maxRadiusMeters' to 'maxRadiusMiles' too, since a raw meters value like
-- "9656" was confusing to edit on the admin Config Management page. The
-- edge function (fetch-nearby-restaurants) now reads the miles-based key and
-- converts to meters internally.
--
-- Converts whatever meters value is currently stored into its mile
-- equivalent (rounded to 1 decimal) rather than hardcoding a number, so this
-- is safe whether the row is still at the old buggy 3000 default or was
-- already customized to something else by an admin. Renaming the primary
-- key in place via UPDATE is safe here — nothing else references it by key.
UPDATE public.app_config
SET
  key = 'maxRadiusMiles',
  value = ROUND((value::numeric / 1609.34), 1)::text,
  description = 'fetch-nearby-restaurants: hard cap on the requested search radius, in miles (stored in miles, not meters, so it''s legible here — must match the consumer app''s max radius option)',
  env_var_name = 'Edge function secret: MAX_RADIUS_MILES',
  updated_at = NOW()
WHERE key = 'maxRadiusMeters';

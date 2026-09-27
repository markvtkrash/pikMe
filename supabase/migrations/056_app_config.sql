-- Shared, DB-backed store for the non-secret client tunables currently
-- hardcoded via each app's own .env (EXPO_PUBLIC_OWNER_SEARCH_RADIUS_METERS,
-- EXPO_PUBLIC_MAX_MANUAL_MENU_ITEMS, EXPO_PUBLIC_SESSION_TIMEOUT_MINUTES,
-- etc). Each app can switch between reading its .env value or this table
-- via its own EXPO_PUBLIC_CONFIG_SOURCE=env|db — see src/constants/appConfig.ts
-- in each app.
--
-- Deliberately excludes anything that's an actual secret (API keys, the
-- service role key) — those stay as Supabase edge function secrets, never
-- as rows in a table any client can read. Also excludes SUPABASE_URL/
-- SUPABASE_ANON_KEY themselves, since an app needs those to connect to the
-- database in the first place, before it could ever read this table.
-- Written to be safely re-runnable: an earlier draft of this file was
-- already applied to some instances before env_var_name and a couple of
-- descriptions were added/fixed here, so every statement below is guarded
-- (IF NOT EXISTS / DROP-then-CREATE / ON CONFLICT) rather than assuming a
-- clean first run.
CREATE TABLE IF NOT EXISTS public.app_config (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,
  description  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Where this value lives when EXPO_PUBLIC_CONFIG_SOURCE (client apps) or
-- APP_CONFIG_SOURCE (edge functions) is set to 'env' instead of 'db' —
-- shown on the admin Config Management page so an admin editing a DB row
-- can see its .env/secret fallback. Purely informational: nothing reads
-- this column at runtime, only the hardcoded env key in each app's own
-- getConfigNumber()/loadDbConfig() call actually drives the fallback.
ALTER TABLE public.app_config ADD COLUMN IF NOT EXISTS env_var_name TEXT;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Readable by anyone — every value in here is a non-secret behavior knob,
-- and apps may need to read it before a user is signed in.
DROP POLICY IF EXISTS "app_config_select_all" ON public.app_config;
CREATE POLICY "app_config_select_all" ON public.app_config
  FOR SELECT USING (true);

-- Only admins can add/change/remove config values (managed via the admin
-- app's Config Management page).
DROP POLICY IF EXISTS "app_config_admin_write" ON public.app_config;
CREATE POLICY "app_config_admin_write" ON public.app_config
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Seeded with the current .env defaults, so flipping EXPO_PUBLIC_CONFIG_SOURCE
-- to 'db' on any app works immediately without requiring an admin to
-- manually populate every value first. On a rerun, refreshes description/
-- env_var_name (documentation, owned by this file) but never touches value
-- (owned by whoever's been editing it from the admin page since).
-- Consumer (user) app has no .env-driven behavior tunables today (its "max
-- fetch radius" is a hardcoded array, not an env var).
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('ownerSearchRadiusMeters', '5000', 'Restaurant search radius (meters) for the owner app''s claim/relocate flows and the admin app''s Create Owner screen — shared setting', 'owner/.env + admin/.env: EXPO_PUBLIC_OWNER_SEARCH_RADIUS_METERS'),
  ('maxManualMenuItems', '100', 'Owner app Edit Menu "+ Add another item" cap', 'owner/.env: EXPO_PUBLIC_MAX_MANUAL_MENU_ITEMS'),
  ('ownerSessionTimeoutMinutes', '30', 'Owner app idle-logout timeout, in minutes', 'owner/.env: EXPO_PUBLIC_SESSION_TIMEOUT_MINUTES'),
  ('adminSessionTimeoutMinutes', '30', 'Admin app idle-logout timeout, in minutes', 'admin/.env: EXPO_PUBLIC_SESSION_TIMEOUT_MINUTES'),
  ('googleMapsApiKey', '', 'Not currently read by any app code (owner/user apps pass it through app.config.js extra, but nothing consumes it) — kept here for when a map provider is wired up to it', 'owner/.env + user/.env: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (currently unused in code)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

GRANT SELECT ON public.app_config TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.app_config TO authenticated;

-- One cached request for the settings the customer app reads, and a minimum app version.
--
--   get_customer_config()   the few app_config values the customer app needs, in ONE call (readable before sign-in):
--                             maxRadiusMiles, showUnconfirmedMenuItems, minAppVersion.
--                           A fixed list: nothing else in app_config is exposed through it. (The franchise / independent
--                           switches are not here: the server applies them, so every app version obeys them.)
--   minAppVersion           (app_config, default 0.0.0) the oldest customer app version allowed to run. A version below it
--                           shows an "update required" screen. Raise it only when an old version can no longer work.
--
-- Backward compatible by design: the customer app is on phones that do not all update, so this only adds a function and a
-- setting. An admin's value is kept when re-run. Safe to re-run.

INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('minAppVersion', '0.0.0', 'Consumer app: the oldest app version (for example 1.2.0) that may run. Older versions show an "update required" screen. Leave 0.0.0 to allow every version.', 'Consumer app: no .env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

CREATE OR REPLACE FUNCTION public.get_customer_config()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(c.key, c.value), '{}'::jsonb)
  FROM public.app_config c
  WHERE c.key IN ('maxRadiusMiles', 'showUnconfirmedMenuItems', 'minAppVersion');
$$;

REVOKE ALL ON FUNCTION public.get_customer_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_config() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

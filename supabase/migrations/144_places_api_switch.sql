-- Which Google Places API the customer search uses: a live switch on the admin Config page.
--
--   app_config placesApiVersion   'legacy' (default) or 'new'.
--     legacy  the Places API we have always used (Nearby Search / Place Details, legacy).
--     new     Places API (New): the same results asked for with a field mask (only what the app uses), nearest first, filtered to food places.
--
-- fetch-nearby-restaurants reads it (kept for a minute), so a switch takes effect without a redeploy. If the new API fails for a request, that request
-- falls back to the legacy API by itself. Anything other than 'new' counts as legacy, so a typo can never switch anything on. The admin Config page has a
-- button for it (it is not edited as plain text there).
--
-- Safe to re-run: an admin's value is kept.

INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('placesApiVersion', 'legacy', 'Server: which Google Places API the customer restaurant search calls: "legacy" (default) or "new" (Places API (New), cheaper per call). Changed with the button on the Config page; a request that fails on the new API falls back to legacy by itself.', 'No .env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

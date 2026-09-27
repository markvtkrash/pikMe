-- Extends the app_config table (see 056_app_config.sql) to cover the
-- non-secret behavior tunables edge functions currently read via
-- Deno.env.get(...). Each edge function switches between its own env var and
-- this table via the shared APP_CONFIG_SOURCE=env|db secret (set once via
-- `supabase secrets set APP_CONFIG_SOURCE=db` — all edge functions on this
-- project share one secrets store, unlike the three separate client apps).
--
-- Real secrets (ANTHROPIC_API_KEY, QUICKSILVER_API_KEY, GOOGLE_PLACES_KEY,
-- SCRAPINGBEE_API_KEY, NUTRITIONIX_APP_ID/KEY, SUPABASE_SERVICE_ROLE_KEY,
-- etc.) are deliberately excluded — those stay as edge function secrets only.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('aiProvider', 'claude', 'AI provider for every AI-backed edge function: "claude" or "quicksilver"', 'Edge function secret: AI_PROVIDER'),
  ('claudeModel', 'claude-haiku-4-5-20251001', 'Claude model name used when aiProvider is "claude"', 'Edge function secret: CLAUDE_MODEL'),
  ('quicksilverModel', 'deepseek-v4-flash', 'Quicksilver model name used for text-only calls when aiProvider is "quicksilver"', 'Edge function secret: QUICKSILVER_MODEL'),
  ('quicksilverVisionModel', 'qwen3.6-35b', 'Quicksilver vision model name used by extract-menu-from-image when aiProvider is "quicksilver"', 'Edge function secret: QUICKSILVER_VISION_MODEL'),
  ('menuItemsCount', '15', 'fetch-menu-items-ai: how many AI-generated menu items to request per restaurant', 'Edge function secret: MENU_ITEMS_COUNT'),
  ('maxRadiusMeters', '3000', 'fetch-nearby-restaurants: hard cap on the requested search radius, in meters', 'Edge function secret: MAX_RADIUS_METERS'),
  ('maxResultPages', '1', 'fetch-nearby-restaurants: max Google Places result pages to fetch per search (1-3; each extra page is a separate billable call)', 'Edge function secret: MAX_RESULT_PAGES')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

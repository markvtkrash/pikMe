-- Global, admin-controlled switch for whether the consumer app shows
-- unconfirmed (is_verified = false) menu items at all — AI-guessed items
-- never checked by the restaurant, and AI-invented fallback items when a
-- restaurant has no real menu data yet. Read once per app session by the
-- consumer app's useMenuRecommendations hook; cached rather than re-fetched
-- per screen. Defaults OFF: a restaurant with only unconfirmed items shows
-- nothing rather than guesses, which is the safer default for something
-- customers may rely on for dietary/allergen decisions. Manageable from the
-- admin app's existing Config Management page — no new UI needed.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('showUnconfirmedMenuItems', 'false', 'Consumer app: show AI-guessed/unconfirmed menu items (not yet checked by the restaurant). OFF = only restaurant-confirmed items are shown to customers.', 'Consumer app: no .env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

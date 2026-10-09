-- menuGuessMaxTokens: the longest AI reply the fetch-menu-items-ai function (the AI guess shown when a restaurant
-- has no stored menu) accepts. It was fixed in the code at 1536 (Quicksilver) and 1024 (Claude), which cuts off a list
-- of about 15 items when the model prints it spread over many lines, giving "Could not parse JSON". Now an admin
-- setting on the Config Management page. Allowed 1024 to 32000; a blank or invalid value falls back to 4096.
-- The function reads it when it starts up, so a change applies the next time the function starts fresh.
-- Re-running never overwrites a value an admin has set.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('menuGuessMaxTokens', '4096', 'Longest AI reply allowed when guessing a restaurant''s menu (1024 to 32000). Raise it if guesses fail with "could not be read" or come back short; each item needs about 60 (about 120 if the model spreads it over many lines). Applies the next time the function starts fresh.', 'Edge function: MENU_GUESS_MAX_TOKENS (optional)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

NOTIFY pgrst, 'reload schema';

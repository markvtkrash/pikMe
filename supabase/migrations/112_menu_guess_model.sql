-- menuGuessModel: the AI model used only for the guessed menu shown when a restaurant has no stored menu
-- (the fetch-menu-items-ai function, started from the customer site). Blank by default, which means "use the
-- app-wide model of the active provider" (quicksilverModel or claudeModel), so adding this row changes nothing
-- until an admin fills it in on the Config Management page. It applies to whichever provider is active
-- (aiProvider): a Quicksilver model name when that is quicksilver, a Claude model name when it is claude.
-- The function reads it when it starts up, so a change applies the next time the function starts fresh.
-- Re-running never overwrites a value an admin has set.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('menuGuessModel', '', 'AI model used only for the guessed menu of a restaurant with no stored menu (started from the customer site). Leave blank to use the app-wide model of the active AI provider. Use a model name that the active provider (aiProvider) offers. Applies the next time the function starts fresh.', 'Edge function: MENU_GUESS_MODEL (optional)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

NOTIFY pgrst, 'reload schema';

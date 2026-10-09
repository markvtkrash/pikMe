-- menuFromTextModel: the AI model used only for reading pasted menu text (the extract-menu-from-text function: the
-- owner's and admin's "paste menu text" upload). Blank by default, which means "use the app-wide model of the active
-- provider" (quicksilverModel or claudeModel), so adding this row changes nothing until an admin fills it in on the
-- Config Management page. The shared quicksilverModel setting is still used by the other functions (chat, onboarding,
-- nutrition estimates, menu builds, ...) and is not renamed. It applies to whichever provider is active (aiProvider): a
-- Quicksilver model name when that is quicksilver, a Claude model name when it is claude.
-- The function reads it when it starts up, so a change applies the next time the function starts fresh.
-- Re-running never overwrites a value an admin has set.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('menuFromTextModel', '', 'AI model used only for reading pasted menu text (the owner and admin "paste menu text" upload). Leave blank to use the app-wide model of the active AI provider (quicksilverModel or claudeModel). Use a model name that the active provider (aiProvider) offers. Applies the next time the function starts fresh.', 'Edge function: MENU_FROM_TEXT_MODEL (optional)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

NOTIFY pgrst, 'reload schema';

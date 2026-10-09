-- textExtractMaxTokens: the longest AI reply the extract-menu-from-text function accepts.
-- It was fixed at 2048 in the code, which cuts off a pasted list of about 20 items (each item carries nine
-- numbers), leaving no usable list and the error "No real menu items were found". Now an admin setting on the
-- Config Management page. Allowed 1024 to 32000; a blank or invalid value falls back to 8192.
-- The function reads it when it starts up, so a change applies the next time the function starts fresh.
-- Re-running never overwrites a value an admin has set.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('textExtractMaxTokens', '8192', 'Longest AI reply allowed when reading pasted menu text (1024 to 32000). Raise it if long pasted menus come back with "No real menu items were found"; each item needs about 60. Applies the next time the function starts fresh.', 'Edge function: TEXT_EXTRACT_MAX_TOKENS (optional)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

NOTIFY pgrst, 'reload schema';

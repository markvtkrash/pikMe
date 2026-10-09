-- photoExtractMaxTokens: the longest AI reply the extract-menu-from-image function (menu photo upload) accepts.
-- It was fixed at 2048 in the code, which cuts off the list read from a photo of a long menu, leaving no usable
-- list and the error "No real menu items were found". Separate from textExtractMaxTokens (pasted text, migration
-- 109) so each can be tuned on its own. Allowed 1024 to 32000; a blank or invalid value falls back to 8192.
-- The function reads it when it starts up, so a change applies the next time the function starts fresh.
-- Re-running never overwrites a value an admin has set.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('photoExtractMaxTokens', '8192', 'Longest AI reply allowed when reading a menu photo (1024 to 32000). Raise it if photos of long menus come back with "No real menu items were found"; each item needs about 60. Applies the next time the function starts fresh.', 'Edge function: PHOTO_EXTRACT_MAX_TOKENS (optional)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

NOTIFY pgrst, 'reload schema';

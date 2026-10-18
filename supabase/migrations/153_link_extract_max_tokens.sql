-- linkExtractMaxTokens: the longest AI reply extract-menu-from-link and refresh-restaurant-menu accept when
-- reading a scraped page or a PDF's text (migration 152 added PDF reading to both; they share this one
-- setting, same as they already share aiProvider/claudeModel/quicksilverModel).
-- It was fixed at 2048 in both functions' code, which cuts off a real menu of about 25-35 items (each item
-- carries nine numbers), leaving the rest of the menu silently missing. Same fix as migration 109 already
-- gave extract-menu-from-text (textExtractMaxTokens). Allowed 1024 to 32000; a blank or invalid value falls
-- back to 8192.
-- Both functions read it when they start up, so a change applies the next time they start fresh.
-- Re-running never overwrites a value an admin has set.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('linkExtractMaxTokens', '8192', 'Longest AI reply allowed when extract-menu-from-link or refresh-restaurant-menu reads a page or PDF (1024 to 32000). Raise it if a long real menu comes back with only part of its items; each item needs about 60. Applies the next time the function starts fresh.', 'Edge function: LINK_EXTRACT_MAX_TOKENS (optional)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

NOTIFY pgrst, 'reload schema';

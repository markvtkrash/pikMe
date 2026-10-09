-- Chain-menu-specific AI settings for the get-chain-menu edge function. Both are
-- blank by default, which means "use the app-wide aiProvider / model", so adding
-- these rows changes nothing until an admin fills one in on the Config
-- Management page. They exist so a fast model can be used just for chain menus.
-- Re-running never overwrites a value an admin has set.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('chainMenuAiProvider', '', 'AI provider used only when building a chain''s menu: claude or quicksilver. Leave blank to use the app-wide AI provider.', 'Edge function: CHAIN_MENU_AI_PROVIDER (optional)'),
  ('chainMenuModel', '', 'AI model used only when building a chain''s menu (for example a fast non-reasoning model). Leave blank to use the provider''s configured model.', 'Edge function: CHAIN_MENU_MODEL (optional)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

-- Optional extra JSON fields for the get-chain-menu AI request, for example the
-- provider-specific switch that turns a reasoning model's "thinking" off.
-- Blank by default (nothing extra is sent). Not a secret. Re-running never
-- overwrites a value an admin has set.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('chainMenuExtraBody', '', 'Extra JSON fields added to the AI request when building a chain''s menu, e.g. {"chat_template_kwargs":{"enable_thinking":false}} to switch off a Qwen model''s reasoning. Must be a JSON object; model, messages and max_tokens cannot be overridden. Leave blank for none.', 'Edge function: CHAIN_MENU_EXTRA_BODY (optional)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

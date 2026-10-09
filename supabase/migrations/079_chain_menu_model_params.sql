-- chainMenuModelParams: extra request parameters for the chain-menu AI model, as
-- semicolon-separated name=value pairs. A dot nests, so
--     reasoning.enabled=false;temperature=0.2
-- is sent as {"reasoning":{"enabled":false},"temperature":0.2}.
-- Blank by default (nothing extra is sent). Not a secret. Re-running never
-- overwrites a value an admin has set.
--
-- This replaces chainMenuExtraBody (migration 077), which took JSON; that row is
-- removed so there is one setting for this, not two.
DELETE FROM public.app_config WHERE key = 'chainMenuExtraBody';

INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('chainMenuModelParams', '', 'Extra parameters sent with the AI request when building a chain''s menu: name=value pairs separated by semicolons, a dot nests. Example: reasoning.enabled=false;temperature=0.2. model, messages and max_tokens cannot be set here. If the provider rejects a parameter the request is retried without them. Leave blank for none.', 'Edge function: CHAIN_MENU_MODEL_PARAMS (optional)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

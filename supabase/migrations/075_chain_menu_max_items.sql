-- Admin-editable cap on how many menu items get-chain-menu keeps per chain.
-- A big chain page (Taco Bell lists ~150 products) takes the function past the
-- edge runtime's per-request time limit, so the default is kept modest. Raise it
-- on the Config Management page if your server's function timeout allows.
-- The function clamps the value to 5..150 and uses 40 if it is missing or not a
-- number. Not a secret, so app_config is the right place. Safe to re-run: the
-- value is never overwritten once an admin has edited it.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('chainMenuMaxItems', '40', 'Most menu items kept per chain when a chain''s menu is built from its website (5–150). Lower = faster and safer against server timeouts; higher = fuller menus.', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

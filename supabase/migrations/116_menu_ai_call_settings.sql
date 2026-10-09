-- Two settings for the AI calls the menu builds make (get-chain-menu: franchise builds and independent builds, including
-- the text the browser crawl worker sends):
--
--   menuNutritionBatchSize   how many dishes go to the AI in one nutrition call (1-50, default 10). It was fixed at 20; with
--                            a slower model a batch of 20 took longer than the AI call limit and was lost.
--   menuAiTimeoutSeconds     how long one AI call may take (5-120, default 30). It was fixed at 15 seconds. A failed call
--                            is tried once more if there is still time left in the request (about a minute on a default
--                            self-hosted install), so a long timeout leaves no room for the retry.
--
-- The function reads them when it starts up, so a change applies the next time the function starts fresh.
-- Re-running never overwrites a value an admin has set.
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('menuNutritionBatchSize', '10', 'Dishes sent to the AI in one nutrition call when a menu is built (1-50). Smaller batches finish sooner and fail less often; larger ones use fewer calls. Applies the next time the function starts fresh.', 'Edge function: MENU_NUTRITION_BATCH_SIZE (optional)'),
  ('menuAiTimeoutSeconds', '30', 'Seconds one AI call may take when a menu is built (5-120). A call that fails is tried once more only if enough of the request time is left, so keep this well under a minute. Applies the next time the function starts fresh.', 'Edge function: MENU_AI_TIMEOUT_SECONDS (optional)')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

NOTIFY pgrst, 'reload schema';

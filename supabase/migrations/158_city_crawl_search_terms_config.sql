-- Makes the City Imports crawler's search-term list (cuisines/food types searched for in every city, beyond the first
-- general "restaurants in <city>" search) admin-editable from the existing Config Management page, instead of fixed in
-- code. No new table or admin UI needed: Config Management already lists and edits every app_config row generically.
--
-- The city-crawl edge function reads this at the start of each discover request and falls back to its own built-in
-- default list (supabase/functions/city-crawl/cityCrawlUtils.ts, CUISINES) if this row is ever missing or cleared.
--
-- A city that stopped because it ran out of results restarts its search from the first term the next time it is run
-- again, so adding a term here and re-running such a city is enough to search the new ground -- no other change needed.
--
-- Safe to re-run: ON CONFLICT only refreshes the description, never the value, so an admin's own edit from the Config
-- page is never overwritten by this migration running again.

INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('cityCrawlSearchTerms',
   'American,Italian,Mexican,Chinese,Japanese,sushi,Thai,Indian,Korean,Vietnamese,Mediterranean,Greek,Middle Eastern,French,Spanish,Caribbean,Southern,barbecue,seafood,steakhouse,pizza,burger,sandwich,breakfast,brunch,vegetarian,vegan,diner,bakery,cafe',
   'Comma-separated cuisine/food-type terms City Imports searches for in every city, beyond its first general "restaurants in <city>" search. Add a term here to broaden what a city can find; a city that already ran out of results restarts from the first term the next time it is run again.',
   'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

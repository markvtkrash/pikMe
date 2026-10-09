-- Test for migration 087: chains_needing_menu_build and run_chain_menu_builds.
-- Self-contained; rolls back. Success: no error (Notices show PASS lines).
-- Requires migrations 062, 072, 073, 082 and 087. Does not call the network: the
-- runner is only checked in its "nothing configured" state.
BEGIN;

INSERT INTO public.franchise_chains (name, aliases, is_active) VALUES
  ('ZZ Q Fresh',   ARRAY[]::text[], true),   -- known store, never built       -> queued first
  ('ZZ Q Stale',   ARRAY[]::text[], true),   -- built long ago                 -> queued
  ('ZZ Q Recent',  ARRAY[]::text[], true),   -- built yesterday                -> not queued
  ('ZZ Q NoStore', ARRAY[]::text[], true),   -- no store, no link              -> not queued
  ('ZZ Q Manual',  ARRAY[]::text[], true),   -- hand-set link, no store        -> queued
  ('ZZ Q Backoff', ARRAY[]::text[], true),   -- failed an hour ago (backdated) -> not queued
  ('ZZ Q Running', ARRAY[]::text[], true),   -- lookup started 1 minute ago    -> not queued
  ('ZZ Q Off',     ARRAY[]::text[], false);  -- inactive                       -> not queued

INSERT INTO public.cached_restaurants (place_id, name) VALUES
  ('zzq_place_fresh_0001', 'ZZ Q Fresh'),
  ('zzq_place_off_000001', 'ZZ Q Off');

INSERT INTO public.franchise_menu_sources (chain_id, source_place_id, menu_link, menu_link_manual, status, fetched_at, updated_at)
SELECT id, 'zzq_place_stale_001', NULL, false, 'ok', NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days' FROM public.franchise_chains WHERE name = 'ZZ Q Stale';
INSERT INTO public.franchise_menu_sources (chain_id, source_place_id, status, fetched_at, updated_at)
SELECT id, 'zzq_place_recent_01', 'ok', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' FROM public.franchise_chains WHERE name = 'ZZ Q Recent';
INSERT INTO public.franchise_menu_sources (chain_id, menu_link, menu_link_manual, status, fetched_at, updated_at)
SELECT id, 'https://example.com/menu', true, 'no_menu_link', NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days' FROM public.franchise_chains WHERE name = 'ZZ Q Manual';
-- error an hour ago: the edge function backdates fetched_at to (now - 30d + 6h)
INSERT INTO public.franchise_menu_sources (chain_id, source_place_id, status, fetched_at, updated_at)
SELECT id, 'zzq_place_backoff_1', 'error', NOW() - INTERVAL '30 days' + INTERVAL '6 hours', NOW() - INTERVAL '1 hour' FROM public.franchise_chains WHERE name = 'ZZ Q Backoff';
INSERT INTO public.franchise_menu_sources (chain_id, source_place_id, status, fetched_at, updated_at)
SELECT id, 'zzq_place_running_1', 'pending', NOW() - INTERVAL '40 days', NOW() - INTERVAL '1 minute' FROM public.franchise_chains WHERE name = 'ZZ Q Running';

CREATE FUNCTION pg_temp.queued(p_limit INTEGER) RETURNS TEXT[] AS $$
  SELECT COALESCE(array_agg(chain_name ORDER BY chain_name), '{}')
  FROM public.chains_needing_menu_build(p_limit, 30)
  WHERE chain_name LIKE 'ZZ Q %'
$$ LANGUAGE sql;

DO $$
BEGIN
  ASSERT pg_temp.queued(1000) = ARRAY['ZZ Q Fresh', 'ZZ Q Manual', 'ZZ Q Stale'],
    'queued: never built (known store), manual link, stale; not recent, no-store, backoff, running or inactive. Got ' || pg_temp.queued(1000)::text;
  RAISE NOTICE 'PASS: the right chains are queued';

  -- ordering: never-built first, then the longest since the last lookup (Manual 40d vs Stale 60d)
  ASSERT (SELECT array_agg(chain_name) FROM (
            SELECT chain_name FROM public.chains_needing_menu_build(1000, 30) WHERE chain_name LIKE 'ZZ Q %'
          ) q) = ARRAY['ZZ Q Fresh', 'ZZ Q Stale', 'ZZ Q Manual'],
    'order: never built, then oldest lookup first';
  RAISE NOTICE 'PASS: order is never-built first, then oldest';

  -- the limit applies to the whole result
  ASSERT (SELECT count(*) FROM public.chains_needing_menu_build(0, 30)) = 0, 'limit 0 returns nothing';
  ASSERT (SELECT count(*) FROM public.chains_needing_menu_build(NULL, 30)) = 0, 'NULL limit returns nothing';
  RAISE NOTICE 'PASS: limit respected';

  -- a long refresh period makes the 60-day-old Stale lookup fresh again
  ASSERT NOT ('ZZ Q Stale' = ANY (ARRAY(SELECT chain_name FROM public.chains_needing_menu_build(1000, 90)))),
    'a 90-day period no longer treats a 60-day-old lookup as stale';
  RAISE NOTICE 'PASS: refresh period honoured';

  -- access: service role only
  ASSERT has_function_privilege('service_role', 'public.chains_needing_menu_build(integer,integer)', 'EXECUTE'), 'service_role can call it';
  ASSERT NOT has_function_privilege('anon', 'public.chains_needing_menu_build(integer,integer)', 'EXECUTE'), 'anon cannot';
  ASSERT NOT has_function_privilege('authenticated', 'public.chains_needing_menu_build(integer,integer)', 'EXECUTE'), 'signed-in users cannot';
  ASSERT NOT has_function_privilege('anon', 'public.run_chain_menu_builds()', 'EXECUTE'), 'anon cannot run the job';
  ASSERT NOT has_function_privilege('authenticated', 'public.run_chain_menu_builds()', 'EXECUTE'), 'signed-in users cannot run the job';
  ASSERT NOT has_table_privilege('anon', 'public.internal_settings', 'SELECT'), 'anon cannot read the key table';
  ASSERT NOT has_table_privilege('authenticated', 'public.internal_settings', 'SELECT'), 'signed-in users cannot read the key table';
  RAISE NOTICE 'PASS: service-role only; the key table is not readable through the API';

  -- the runner starts nothing while the key is not stored
  DELETE FROM public.internal_settings WHERE key IN ('functions_url', 'service_key');
  ASSERT public.run_chain_menu_builds() = 0, 'runner does nothing without a key';
  RAISE NOTICE 'ALL 087 TESTS PASSED';
END $$;

ROLLBACK;

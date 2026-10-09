-- Regression tests for migration 072: menu_source_is_stale, the
-- franchise_menu_sources table (one row per chain, status check, cascade,
-- updated_at trigger) and the serpapiMenuRefreshDays config row.
-- Self-contained: inserts its own test chain inside a transaction and rolls
-- back. Run after 062 and 072 are applied.
--
-- Run in the Supabase SQL editor (or psql -f). Success: "PASS: ..." notices
-- and no error. A failed ASSERT aborts with the test name.
--
-- Like the other SQL tests this runs as the database owner, so it does not
-- exercise row-level security or role grants.

BEGIN;

DO $$
DECLARE
  v_now      TIMESTAMPTZ := '2026-10-04 12:00:00+00';
  v_chain    UUID;
  v_source   UUID;
  v_before   TIMESTAMPTZ;
BEGIN
  -- ── menu_source_is_stale ────────────────────────────────────────────────────
  ASSERT public.menu_source_is_stale(NULL, 30, v_now), 'never fetched is stale';
  ASSERT NOT public.menu_source_is_stale(v_now, 30, v_now), 'fetched just now is fresh';
  ASSERT NOT public.menu_source_is_stale(v_now - interval '29 days 23 hours', 30, v_now), 'just under 30 days is fresh';
  ASSERT public.menu_source_is_stale(v_now - interval '30 days', 30, v_now), 'exactly 30 days is stale (boundary)';
  ASSERT public.menu_source_is_stale(v_now - interval '31 days', 30, v_now), '31 days is stale';
  ASSERT NOT public.menu_source_is_stale(v_now - interval '59 days', 60, v_now), '59 days is fresh at 60';
  ASSERT public.menu_source_is_stale(v_now - interval '60 days', 60, v_now), '60 days is stale at 60';
  ASSERT NOT public.menu_source_is_stale(v_now - interval '10 days', 1000, v_now), 'huge setting still works for recent data';
  RAISE NOTICE 'PASS: menu_source_is_stale basic behaviour';

  -- Bad settings fall back to 30 days; they never mean "always refresh".
  ASSERT NOT public.menu_source_is_stale(v_now - interval '10 days', NULL, v_now), 'NULL days -> default 30, 10d old is fresh';
  ASSERT NOT public.menu_source_is_stale(v_now - interval '10 days', 0, v_now), '0 days -> default 30 (not always-refresh)';
  ASSERT NOT public.menu_source_is_stale(v_now - interval '10 days', -5, v_now), 'negative days -> default 30';
  ASSERT public.menu_source_is_stale(v_now - interval '31 days', 0, v_now), '0 days -> default 30, 31d old is stale';
  -- Upper cap of 365 days.
  ASSERT NOT public.menu_source_is_stale(v_now - interval '364 days', 99999, v_now), '364d old is fresh under the 365 cap';
  ASSERT public.menu_source_is_stale(v_now - interval '365 days', 99999, v_now), '365d old is stale: setting is capped at 365';
  RAISE NOTICE 'PASS: menu_source_is_stale bad settings and cap';

  -- ── Config row ──────────────────────────────────────────────────────────────
  ASSERT EXISTS (
    SELECT 1 FROM public.app_config
    WHERE key = 'serpapiMenuRefreshDays' AND value ~ '^[0-9]+$' AND value::int BETWEEN 1 AND 365
  ), 'serpapiMenuRefreshDays config row exists with a numeric value 1-365';
  RAISE NOTICE 'PASS: serpapiMenuRefreshDays config row';

  -- ── Table ───────────────────────────────────────────────────────────────────
  INSERT INTO public.franchise_chains (name, aliases) VALUES ('ZZ Menu Source Chain', ARRAY[]::TEXT[])
  RETURNING id INTO v_chain;

  INSERT INTO public.franchise_menu_sources (chain_id, source_place_id, menu_link, menu_source, highlights)
  VALUES (v_chain, 'ChIJtest', 'https://example.com/menu', 'example.com', ARRAY['Taco', 'Burrito'])
  RETURNING id INTO v_source;

  ASSERT (SELECT status FROM public.franchise_menu_sources WHERE id = v_source) = 'pending', 'status defaults to pending';
  ASSERT (SELECT item_count FROM public.franchise_menu_sources WHERE id = v_source) = 0, 'item_count defaults to 0';
  ASSERT (SELECT place_types FROM public.franchise_menu_sources WHERE id = v_source) = '{}', 'place_types defaults to empty';
  ASSERT (SELECT fetched_at FROM public.franchise_menu_sources WHERE id = v_source) IS NOT NULL, 'fetched_at is set by default';
  RAISE NOTICE 'PASS: defaults';

  -- One row per chain.
  BEGIN
    INSERT INTO public.franchise_menu_sources (chain_id) VALUES (v_chain);
    ASSERT false, 'second row for the same chain should have been rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: one row per chain';
  END;

  -- Status must be one of the known values.
  BEGIN
    UPDATE public.franchise_menu_sources SET status = 'bogus' WHERE id = v_source;
    ASSERT false, 'unknown status should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: status check';
  END;

  UPDATE public.franchise_menu_sources SET status = 'ok' WHERE id = v_source;
  UPDATE public.franchise_menu_sources SET status = 'no_menu_link' WHERE id = v_source;
  UPDATE public.franchise_menu_sources SET status = 'unreadable' WHERE id = v_source;
  UPDATE public.franchise_menu_sources SET status = 'error' WHERE id = v_source;
  RAISE NOTICE 'PASS: all documented statuses accepted';

  -- item_count cannot be negative.
  BEGIN
    UPDATE public.franchise_menu_sources SET item_count = -1 WHERE id = v_source;
    ASSERT false, 'negative item_count should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: item_count check';
  END;

  -- Chain must exist.
  BEGIN
    INSERT INTO public.franchise_menu_sources (chain_id) VALUES (gen_random_uuid());
    ASSERT false, 'unknown chain_id should have been rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: chain_id foreign key';
  END;

  -- updated_at moves forward on update (set the old value explicitly: inside one
  -- transaction NOW() is constant, so compare against a value in the past).
  UPDATE public.franchise_menu_sources SET updated_at = '2000-01-01' WHERE id = v_source;
  UPDATE public.franchise_menu_sources SET menu_source = 'changed.com' WHERE id = v_source;
  SELECT updated_at INTO v_before FROM public.franchise_menu_sources WHERE id = v_source;
  ASSERT v_before > '2000-01-01', 'updated_at is refreshed by the trigger';
  RAISE NOTICE 'PASS: updated_at trigger';

  -- Deleting the chain removes its source row.
  SELECT chain_id INTO v_chain FROM public.franchise_menu_sources WHERE id = v_source;
  DELETE FROM public.franchise_chains WHERE id = v_chain;
  ASSERT NOT EXISTS (SELECT 1 FROM public.franchise_menu_sources WHERE id = v_source), 'source row cascades with its chain';
  RAISE NOTICE 'PASS: cascade on chain delete';

  RAISE NOTICE 'ALL 072 TESTS PASSED';
END $$;

ROLLBACK;

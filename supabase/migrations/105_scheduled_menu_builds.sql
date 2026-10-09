-- One scheduled job for both kinds of menu build (phase 5).
--
-- Every 30 minutes the existing job (still named chain-menu-builds, so the Scheduled builds panel keeps working) now
-- runs run_scheduled_menu_builds(), which does two things with their own limits:
--   * chains     the same selection as before (chains never built, or due for a refresh, that have a store, a link or
--                a built-in page), up to chainMenuBuildsPerRun
--   * places     the busiest waiting independent restaurants from the menu queue (customers opened them with no
--                menu), up to placeMenuBuildsPerRun per run AND placeMenuBuildsPerDay in any 24 hours
-- Each place job reports its own result back to the queue, which handles retries and flags restaurants that need
-- attention. The admin panel gets the two place limits, the queue counts and a combined recent-builds list.
--
-- Needs pg_cron (as for migration 088) to reschedule; without it everything else here still applies.
-- "Run queue now" (migration 102) is not subject to the daily cap. Safe to re-run.

INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('placeMenuBuildsPerDay', '50', 'Most independent-restaurant menu builds the scheduled job starts in any 24 hours (0 pauses them, max 1000). A spending cap on top of the per-run limit.', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

-- ── 1. Start the waiting independents, within both limits ───────────────────
CREATE OR REPLACE FUNCTION public._start_place_builds_capped(p_source TEXT DEFAULT 'scheduled')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url     TEXT;
  v_key     TEXT;
  v_per_run INTEGER := public._menu_setting('placeMenuBuildsPerRun', 3, 0, 20);
  v_per_day INTEGER := public._menu_setting('placeMenuBuildsPerDay', 50, 0, 1000);
  v_done    INTEGER;
  v_limit   INTEGER;
  v_job     RECORD;
  v_count   INTEGER := 0;
BEGIN
  SELECT value INTO v_url FROM public.internal_settings WHERE key = 'functions_url';
  SELECT value INTO v_key FROM public.internal_settings WHERE key = 'service_key';
  IF v_url IS NULL OR v_key IS NULL OR btrim(v_url) = '' OR btrim(v_key) = '' THEN
    RETURN 0;
  END IF;

  -- how many place builds started in the last 24 hours
  SELECT COUNT(*) INTO v_done FROM public.menu_build_queue q
  WHERE q.kind = 'place' AND q.started_at > NOW() - INTERVAL '24 hours';
  v_limit := LEAST(v_per_run, GREATEST(v_per_day - v_done, 0));
  IF v_limit <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_job IN SELECT * FROM public.claim_menu_builds(0, v_limit) LOOP
    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/get-chain-menu',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('mode', 'place', 'placeId', v_job.place_id, 'restaurantName', v_job.restaurant_name, 'jobId', v_job.job_id),
      timeout_milliseconds := 60000
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._start_place_builds_capped(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._start_place_builds_capped(TEXT) TO service_role;

-- ── 2. The scheduled entry point ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_scheduled_menu_builds()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'chains', public._start_chain_menu_builds('scheduled'),
    'places', public._start_place_builds_capped('scheduled')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_menu_builds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_scheduled_menu_builds() TO service_role;

-- ── 3. Reschedule: every 30 minutes, both kinds ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not installed: the schedule was not changed.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chain-menu-builds') THEN
    PERFORM cron.unschedule('chain-menu-builds');
  END IF;
  PERFORM cron.schedule('chain-menu-builds', '7,37 * * * *', 'SELECT public.run_scheduled_menu_builds()');
  RAISE NOTICE 'Scheduled chain-menu-builds at minutes 7 and 37 of every hour (chains and independent restaurants).';
END $$;

-- ── 4. Admin panel: status with the place limits and queue counts ───────────
DROP FUNCTION IF EXISTS public.admin_chain_build_status();

CREATE FUNCTION public.admin_chain_build_status()
RETURNS TABLE (
  cron_installed   BOOLEAN,
  job_scheduled    BOOLEAN,
  job_active       BOOLEAN,
  job_schedule     TEXT,
  per_run          INTEGER,
  configured       BOOLEAN,
  queued_count     BIGINT,
  queued_names     TEXT[],
  last_run_at      TIMESTAMPTZ,
  last_run_status  TEXT,
  last_run_detail  TEXT,
  place_per_run    INTEGER,
  place_per_day    INTEGER,
  places_waiting   BIGINT,
  places_attention BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_installed BOOLEAN := to_regclass('cron.job') IS NOT NULL;
  v_scheduled BOOLEAN := false;
  v_active    BOOLEAN := false;
  v_schedule  TEXT;
  v_jobid     BIGINT;
  v_per_run   INTEGER;
  v_last_at   TIMESTAMPTZ;
  v_last_st   TEXT;
  v_last_msg  TEXT;
BEGIN
  PERFORM public._require_admin();

  IF v_installed THEN
    EXECUTE 'SELECT jobid, active, schedule FROM cron.job WHERE jobname = $1'
      INTO v_jobid, v_active, v_schedule USING 'chain-menu-builds';
    v_scheduled := v_jobid IS NOT NULL;
    IF v_scheduled AND to_regclass('cron.job_run_details') IS NOT NULL THEN
      EXECUTE 'SELECT start_time, status, return_message FROM cron.job_run_details WHERE jobid = $1 ORDER BY start_time DESC LIMIT 1'
        INTO v_last_at, v_last_st, v_last_msg USING v_jobid;
    END IF;
  END IF;

  SELECT CASE WHEN c.value ~ '^[0-9]{1,3}$' THEN LEAST(c.value::INTEGER, 20) ELSE 3 END
    INTO v_per_run FROM public.app_config c WHERE c.key = 'chainMenuBuildsPerRun';

  RETURN QUERY
  SELECT
    v_installed,
    v_scheduled,
    COALESCE(v_active, false),
    v_schedule,
    COALESCE(v_per_run, 3),
    EXISTS (SELECT 1 FROM public.internal_settings WHERE key = 'functions_url' AND btrim(value) <> '')
      AND EXISTS (SELECT 1 FROM public.internal_settings WHERE key = 'service_key' AND btrim(value) <> ''),
    (SELECT COUNT(*) FROM public.chains_needing_menu_build(1000)),
    COALESCE((SELECT array_agg(q.chain_name) FROM public.chains_needing_menu_build(5) q), '{}'::TEXT[]),
    v_last_at,
    v_last_st,
    left(v_last_msg, 300),
    public._menu_setting('placeMenuBuildsPerRun', 3, 0, 20),
    public._menu_setting('placeMenuBuildsPerDay', 50, 0, 1000),
    (SELECT COUNT(*) FROM public.menu_build_queue q WHERE q.kind = 'place' AND q.status = 'waiting'),
    (SELECT COUNT(*) FROM public.menu_build_queue q WHERE q.kind = 'place' AND q.status = 'needs_attention');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_chain_build_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_chain_build_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_place_builds_per_run(p_per_run INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  IF p_per_run IS NULL OR p_per_run < 0 OR p_per_run > 20 THEN
    RAISE EXCEPTION 'Restaurants per run must be a whole number from 0 (paused) to 20';
  END IF;
  UPDATE public.app_config SET value = p_per_run::TEXT WHERE key = 'placeMenuBuildsPerRun';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_place_builds_per_day(p_per_day INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  IF p_per_day IS NULL OR p_per_day < 0 OR p_per_day > 1000 THEN
    RAISE EXCEPTION 'The daily cap must be a whole number from 0 (paused) to 1000';
  END IF;
  UPDATE public.app_config SET value = p_per_day::TEXT WHERE key = 'placeMenuBuildsPerDay';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_place_builds_per_run(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_place_builds_per_day(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_place_builds_per_run(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_place_builds_per_day(INTEGER) TO authenticated;

-- ── 5. Recent builds: chains (the log) and independent restaurants (the queue) together ──
DROP FUNCTION IF EXISTS public.admin_list_chain_build_log(INTEGER);

CREATE FUNCTION public.admin_list_chain_build_log(p_hours INTEGER DEFAULT 24)
RETURNS TABLE (
  started_at  TIMESTAMPTZ,
  chain_id    UUID,
  chain_name  TEXT,
  source      TEXT,
  outcome     TEXT,
  item_count  INTEGER,
  detail      TEXT,
  finished_at TIMESTAMPTZ,
  kind        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - make_interval(hours => LEAST(GREATEST(COALESCE(p_hours, 24), 1), 720));
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT b.* FROM (
    SELECT
      l.started_at,
      l.chain_id,
      l.chain_name,
      l.source,
      CASE
        WHEN s.id IS NOT NULL AND s.updated_at >= l.started_at AND s.status <> 'pending' THEN s.status
        WHEN l.started_at < NOW() - INTERVAL '10 minutes' THEN 'no_result'
        ELSE 'running'
      END AS outcome,
      COALESCE(s.item_count, 0) AS item_count,
      s.status_detail AS detail,
      CASE WHEN s.id IS NOT NULL AND s.updated_at >= l.started_at AND s.status <> 'pending' THEN s.updated_at END AS finished_at,
      'chain'::TEXT AS kind
    FROM public.chain_build_log l
    LEFT JOIN public.franchise_menu_sources s ON s.chain_id = l.chain_id
    WHERE l.started_at > v_cutoff

    UNION ALL

    SELECT
      q.started_at,
      NULL::UUID,
      q.restaurant_name,
      'queue'::TEXT,
      CASE q.status
        WHEN 'built' THEN 'ok'
        WHEN 'building' THEN CASE WHEN q.started_at < NOW() - INTERVAL '10 minutes' THEN 'no_result' ELSE 'running' END
        ELSE q.status
      END,
      (SELECT COUNT(*)::INTEGER FROM public.menu_items mi WHERE mi.place_id = q.place_id),
      q.last_detail,
      CASE WHEN q.status <> 'building' THEN q.finished_at END,
      'place'::TEXT
    FROM public.menu_build_queue q
    WHERE q.kind = 'place' AND q.started_at IS NOT NULL AND q.started_at > v_cutoff
  ) b
  ORDER BY b.started_at DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_chain_build_log(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_chain_build_log(INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

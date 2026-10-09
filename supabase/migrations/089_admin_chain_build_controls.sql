-- Admin controls for the scheduled chain-menu builds (migrations 087/088), used by the
-- "Scheduled builds" panel on the Chain Menus page.
--
--   admin_chain_build_status()          one row: is the job scheduled and active, builds per run,
--                                       how many chains are waiting (and the first few names), whether
--                                       the key/URL are stored, and the last run's outcome.
--   admin_set_chain_builds_per_run(n)   sets chainMenuBuildsPerRun (0 pauses the job; max 20).
--   admin_run_chain_builds_now()        starts a batch right away (same as the hourly run); returns
--                                       how many chains were started.
--
-- Same pattern as the other admin functions: SECURITY DEFINER + _require_admin(), executable by
-- signed-in users only (the admin check inside decides), never anon. They never return the
-- service key. cron.* is only touched when pg_cron is installed, so this is safe without it.
-- Safe to re-run.

-- ── 1. Status ───────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_chain_build_status();

CREATE FUNCTION public.admin_chain_build_status()
RETURNS TABLE (
  cron_installed  BOOLEAN,
  job_scheduled   BOOLEAN,
  job_active      BOOLEAN,
  job_schedule    TEXT,
  per_run         INTEGER,
  configured      BOOLEAN,
  queued_count    BIGINT,
  queued_names    TEXT[],
  last_run_at     TIMESTAMPTZ,
  last_run_status TEXT,
  last_run_detail TEXT
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
    left(v_last_msg, 300);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_chain_build_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_chain_build_status() TO authenticated;

-- ── 2. Builds per run ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_chain_builds_per_run(p_per_run INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  IF p_per_run IS NULL OR p_per_run < 0 OR p_per_run > 20 THEN
    RAISE EXCEPTION 'Builds per run must be a whole number from 0 (paused) to 20';
  END IF;
  UPDATE public.app_config SET value = p_per_run::TEXT WHERE key = 'chainMenuBuildsPerRun';
  IF NOT FOUND THEN
    INSERT INTO public.app_config (key, value, description, env_var_name)
    VALUES ('chainMenuBuildsPerRun', p_per_run::TEXT,
            'Scheduled chain menu builds started per hourly run (0 pauses the job, max 20).',
            'Edge function: no env equivalent, DB-only');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_chain_builds_per_run(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_chain_builds_per_run(INTEGER) TO authenticated;

-- ── 3. Run now ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_run_chain_builds_now()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN public.run_chain_menu_builds();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_chain_builds_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_chain_builds_now() TO authenticated;

NOTIFY pgrst, 'reload schema';

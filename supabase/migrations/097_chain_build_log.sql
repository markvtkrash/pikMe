-- A log of which chains the scheduled job (and "Run a batch now") started, so the admin page can list
-- "chains built in the last N hours" exactly: franchise_menu_sources alone cannot tell a scheduled build
-- from a manual pull or an edit.
--
--   chain_build_log                     one row per chain started (time, chain, "scheduled" or "run now").
--                                       Rows older than 30 days are removed each run. Not readable through the API.
--   _start_chain_menu_builds(source)    the runner's logic (migration 087) plus the log row; run_chain_menu_builds()
--                                       (the scheduled job) and admin_run_chain_builds_now() both call it.
--   admin_list_chain_build_log(hours)   the log with each chain's outcome (admin-only, signed-in users only).
--
-- The outcome shown is the chain's CURRENT lookup state, so if a chain is built again later, its earlier log rows
-- show the newer result. "running" = started and not finished; "no_result" = started over 10 minutes ago and
-- never finished (the build was cut off). Safe to re-run.

-- ── 1. Log table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chain_build_log (
  id         BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  chain_id   UUID NOT NULL REFERENCES public.franchise_chains(id) ON DELETE CASCADE,
  chain_name TEXT NOT NULL,
  source     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chain_build_log_started ON public.chain_build_log (started_at DESC);
ALTER TABLE public.chain_build_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chain_build_log FROM PUBLIC, anon, authenticated;

-- ── 2. The runner, now logging ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._start_chain_menu_builds(p_source TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url   TEXT;
  v_key   TEXT;
  v_limit INTEGER;
  v_row   RECORD;
  v_count INTEGER := 0;
BEGIN
  SELECT value INTO v_url FROM public.internal_settings WHERE key = 'functions_url';
  SELECT value INTO v_key FROM public.internal_settings WHERE key = 'service_key';
  IF v_url IS NULL OR v_key IS NULL OR btrim(v_url) = '' OR btrim(v_key) = '' THEN
    RAISE NOTICE 'chain menu builds: functions_url / service_key not set in internal_settings, nothing started';
    RETURN 0;
  END IF;

  SELECT CASE WHEN c.value ~ '^[0-9]{1,3}$' THEN LEAST(c.value::INTEGER, 20) ELSE 3 END
    INTO v_limit FROM public.app_config c WHERE c.key = 'chainMenuBuildsPerRun';
  v_limit := COALESCE(v_limit, 3);
  IF v_limit <= 0 THEN RETURN 0; END IF;

  -- keep the log short
  DELETE FROM public.chain_build_log WHERE started_at < NOW() - INTERVAL '30 days';

  FOR v_row IN SELECT * FROM public.chains_needing_menu_build(v_limit) LOOP
    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/get-chain-menu',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('chainId', v_row.chain_id),
      timeout_milliseconds := 60000
    );
    INSERT INTO public.chain_build_log (chain_id, chain_name, source) VALUES (v_row.chain_id, v_row.chain_name, COALESCE(p_source, 'scheduled'));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._start_chain_menu_builds(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._start_chain_menu_builds(TEXT) TO service_role;

-- The scheduled job (pg_cron calls this one, migration 088).
CREATE OR REPLACE FUNCTION public.run_chain_menu_builds()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._start_chain_menu_builds('scheduled');
END;
$$;

-- "Run a batch now" on the Franchise Menu Management page.
CREATE OR REPLACE FUNCTION public.admin_run_chain_builds_now()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN public._start_chain_menu_builds('run now');
END;
$$;

-- ── 3. The list for the admin page ──────────────────────────────────────────
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
  finished_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    l.started_at,
    l.chain_id,
    l.chain_name,
    l.source,
    CASE
      WHEN s.id IS NOT NULL AND s.updated_at >= l.started_at AND s.status <> 'pending' THEN s.status
      WHEN l.started_at < NOW() - INTERVAL '10 minutes' THEN 'no_result'
      ELSE 'running'
    END,
    COALESCE(s.item_count, 0),
    s.status_detail,
    CASE WHEN s.id IS NOT NULL AND s.updated_at >= l.started_at AND s.status <> 'pending' THEN s.updated_at END
  FROM public.chain_build_log l
  LEFT JOIN public.franchise_menu_sources s ON s.chain_id = l.chain_id
  WHERE l.started_at > NOW() - make_interval(hours => LEAST(GREATEST(COALESCE(p_hours, 24), 1), 720))
  ORDER BY l.started_at DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_chain_build_log(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_chain_build_log(INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

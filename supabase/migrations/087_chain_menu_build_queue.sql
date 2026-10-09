-- Scheduled chain-menu builds, part 1: the queue, the runner and where its key lives.
-- (Part 2, migration 088, schedules the runner with pg_cron.)
--
-- Idea: instead of a customer's visit triggering paid lookups, a scheduled job asks
-- the database which chains need a menu, takes a few per run, and calls the
-- get-chain-menu edge function for each. A chain only qualifies when there is
-- something to look up: a store of the chain has been seen (cached or claimed),
-- one was stored by an earlier lookup, or an admin saved a menu link by hand.
-- Spend is capped by chainMenuBuildsPerRun (app_config), per run.
--
-- Retry windows need no extra logic here: a failed or empty lookup backdates
-- franchise_menu_sources.fetched_at (6h after an error, 72h after "no menu link" /
-- "unreadable"), so menu_source_is_stale already says "not yet".
--
-- Safe to re-run.

-- ── 1. Settings ─────────────────────────────────────────────────────────────
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('chainMenuBuildsPerRun', '3', 'Scheduled chain menu builds started per hourly run (0 pauses the job, max 20). Each build can use a SerpApi credit, a page render and AI calls.', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

-- ── 2. Private settings (the service key). NOT app_config: that is publicly readable.
-- RLS on with no policies and no grants for the API roles: only the database owner
-- (and this migration's SECURITY DEFINER runner) can read it.
CREATE TABLE IF NOT EXISTS public.internal_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.internal_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.internal_settings FROM PUBLIC, anon, authenticated;

-- ── 3. The queue ────────────────────────────────────────────────────────────
-- Chains to build now, most deserving first: never built, then longest since the last
-- lookup. p_days = the refresh period (NULL reads serpapiMenuRefreshDays, default 30).
CREATE OR REPLACE FUNCTION public.chains_needing_menu_build(
  p_limit INTEGER DEFAULT 3,
  p_days  INTEGER DEFAULT NULL
)
RETURNS TABLE (chain_id UUID, chain_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := p_days;
BEGIN
  IF v_days IS NULL THEN
    SELECT CASE WHEN c.value ~ '^[0-9]{1,4}$' THEN c.value::INTEGER ELSE NULL END
      INTO v_days FROM public.app_config c WHERE c.key = 'serpapiMenuRefreshDays';
  END IF;
  v_days := COALESCE(v_days, 30);

  RETURN QUERY
  SELECT fc.id, fc.name
  FROM public.franchise_chains fc
  LEFT JOIN public.franchise_menu_sources s ON s.chain_id = fc.id
  WHERE fc.is_active
    AND (
      s.id IS NULL
      OR (
        public.menu_source_is_stale(s.fetched_at, v_days)
        -- a lookup that started minutes ago is still running
        AND NOT (s.status = 'pending' AND s.updated_at > NOW() - INTERVAL '10 minutes')
      )
    )
    AND (
      (s.menu_link_manual AND s.menu_link IS NOT NULL)
      OR s.source_place_id IS NOT NULL
      OR public.find_chain_place_id(fc.id) IS NOT NULL
    )
  ORDER BY (s.id IS NULL) DESC, s.fetched_at ASC NULLS FIRST, fc.name
  LIMIT GREATEST(COALESCE(p_limit, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.chains_needing_menu_build(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chains_needing_menu_build(INTEGER, INTEGER) TO service_role;

-- ── 4. The runner ───────────────────────────────────────────────────────────
-- Starts the builds. Does nothing (returns 0) until the key and URL are stored and
-- while chainMenuBuildsPerRun is 0. Each build is an asynchronous HTTP call (pg_net)
-- to get-chain-menu with the service key and just {chainId}: not forced, so the edge
-- function applies the same refresh rules again before spending anything.
CREATE OR REPLACE FUNCTION public.run_chain_menu_builds()
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
    RAISE NOTICE 'run_chain_menu_builds: functions_url / service_key not set in internal_settings, nothing started';
    RETURN 0;
  END IF;

  SELECT CASE WHEN c.value ~ '^[0-9]{1,3}$' THEN LEAST(c.value::INTEGER, 20) ELSE 3 END
    INTO v_limit FROM public.app_config c WHERE c.key = 'chainMenuBuildsPerRun';
  v_limit := COALESCE(v_limit, 3);
  IF v_limit <= 0 THEN RETURN 0; END IF;

  FOR v_row IN SELECT * FROM public.chains_needing_menu_build(v_limit) LOOP
    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/get-chain-menu',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('chainId', v_row.chain_id),
      timeout_milliseconds := 60000
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.run_chain_menu_builds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_chain_menu_builds() TO service_role;

NOTIFY pgrst, 'reload schema';

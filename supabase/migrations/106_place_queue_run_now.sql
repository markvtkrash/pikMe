-- "Run now" for independent restaurants only (so the Scheduled builds panel can keep franchises and restaurants apart).
--
--   _start_place_builds_capped(source, apply_daily_cap)   the runner of migration 105 with an option: the scheduled job
--                                                          applies the daily cap (the default); a manual run does not
--   admin_run_place_queue_now()                            "Run queue now": starts the busiest waiting independent
--                                                          restaurants, up to placeMenuBuildsPerRun, and returns how many.
--                                                          Franchises are started by "Run a batch now" and the schedule.
-- Safe to re-run.

DROP FUNCTION IF EXISTS public._start_place_builds_capped(TEXT);

CREATE OR REPLACE FUNCTION public._start_place_builds_capped(
  p_source          TEXT DEFAULT 'scheduled',
  p_apply_daily_cap BOOLEAN DEFAULT TRUE
)
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

  IF COALESCE(p_apply_daily_cap, TRUE) THEN
    SELECT COUNT(*) INTO v_done FROM public.menu_build_queue q
    WHERE q.kind = 'place' AND q.started_at > NOW() - INTERVAL '24 hours';
    v_limit := LEAST(v_per_run, GREATEST(v_per_day - v_done, 0));
  ELSE
    v_limit := v_per_run;
  END IF;
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

REVOKE ALL ON FUNCTION public._start_place_builds_capped(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._start_place_builds_capped(TEXT, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_run_place_queue_now()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN public._start_place_builds_capped('run now', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_place_queue_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_place_queue_now() TO authenticated;

NOTIFY pgrst, 'reload schema';

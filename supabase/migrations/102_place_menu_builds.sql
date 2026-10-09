-- Place-level menu builds (phase 4): starting the queue's jobs.
--
--   menu_build_queue.override_link          an admin's menu link for one place (read as is, Google is not asked);
--                                           the admin screen for setting it comes in a later phase
--   replace_place_pulled_items(...)         swaps a place's PULLED (unverified) items for new ones in one step, so a
--                                           failed save never leaves the place with none; verified items stay
--   _start_menu_queue_builds(source)        takes the busiest due jobs from the queue and starts each one by calling the
--                                           get-chain-menu edge function (a place job: mode 'place'; a chain job: its
--                                           chain id), with the service key. Each call reports its own result back to the
--                                           queue (finish_menu_build)
--   admin_run_menu_queue_now()              the "Run queue now" button on the Scheduled builds panel
--
-- It uses the same functions URL and key as the chain job (internal_settings, migration 087) and does nothing until
-- they are stored. Builds per run: chainMenuBuildsPerRun for chains (existing setting), placeMenuBuildsPerRun for places.
-- Safe to re-run.

INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('placeMenuBuildsPerRun', '3', 'Independent-restaurant menu builds started per run of the menu queue (0 pauses them, max 20). Each can use a Google lookup, a page read and AI calls.', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

ALTER TABLE public.menu_build_queue ADD COLUMN IF NOT EXISTS override_link TEXT;

-- ── Swap a place's pulled items ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.replace_place_pulled_items(
  p_place_id        TEXT,
  p_restaurant_name TEXT,
  p_items           JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- one transaction: if the save fails, the delete is undone too
  PERFORM public.delete_place_menu_items(p_place_id, TRUE);
  RETURN public.upsert_place_menu_items(p_place_id, p_restaurant_name, p_items);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_place_pulled_items(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_place_pulled_items(TEXT, TEXT, JSONB) TO service_role;

-- ── Start the queue's jobs ──────────────────────────────────────────────────
-- Returns {"chains": n, "places": m}: how many of each were started.
CREATE OR REPLACE FUNCTION public._start_menu_queue_builds(p_source TEXT DEFAULT 'scheduled')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    TEXT;
  v_key    TEXT;
  v_chains INTEGER := public._menu_setting('chainMenuBuildsPerRun', 3, 0, 20);
  v_places INTEGER := public._menu_setting('placeMenuBuildsPerRun', 3, 0, 20);
  v_job    RECORD;
  v_body   JSONB;
  v_nc     INTEGER := 0;
  v_np     INTEGER := 0;
BEGIN
  SELECT value INTO v_url FROM public.internal_settings WHERE key = 'functions_url';
  SELECT value INTO v_key FROM public.internal_settings WHERE key = 'service_key';
  IF v_url IS NULL OR v_key IS NULL OR btrim(v_url) = '' OR btrim(v_key) = '' THEN
    RAISE NOTICE 'menu queue: functions_url / service_key not set in internal_settings, nothing started';
    RETURN jsonb_build_object('chains', 0, 'places', 0);
  END IF;
  IF v_chains = 0 AND v_places = 0 THEN
    RETURN jsonb_build_object('chains', 0, 'places', 0);
  END IF;

  FOR v_job IN SELECT * FROM public.claim_menu_builds(v_chains, v_places) LOOP
    IF v_job.kind = 'place' THEN
      v_body := jsonb_build_object('mode', 'place', 'placeId', v_job.place_id, 'restaurantName', v_job.restaurant_name, 'jobId', v_job.job_id);
      v_np := v_np + 1;
    ELSE
      v_body := jsonb_build_object('chainId', v_job.chain_id, 'jobId', v_job.job_id);
      v_nc := v_nc + 1;
    END IF;
    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/get-chain-menu',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := v_body,
      timeout_milliseconds := 60000
    );
  END LOOP;

  RETURN jsonb_build_object('chains', v_nc, 'places', v_np);
END;
$$;

REVOKE ALL ON FUNCTION public._start_menu_queue_builds(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._start_menu_queue_builds(TEXT) TO service_role;

-- ── "Run queue now" ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_run_menu_queue_now()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN public._start_menu_queue_builds('run now');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_menu_queue_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_menu_queue_now() TO authenticated;

NOTIFY pgrst, 'reload schema';

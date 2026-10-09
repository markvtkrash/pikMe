-- The menu build queue (phase 3 of per-place menus): one list of "restaurants that need a real menu", for both
-- kinds of job, with a status, an attempt count and a retry time.
--
--   kind 'chain'  one job per franchise chain (the shared chain menu)
--   kind 'place'  one job per independent restaurant (by Google place ID)
--
-- A job is added by the SERVER when a customer opens a restaurant that has no stored menu (enqueue_menu_build,
-- called from the AI-guess function). Only a place that exists in the Google cache can be queued, so the queue
-- cannot be filled with made-up IDs. The scheduled job (a later phase) takes jobs with claim_menu_builds and reports
-- back with finish_menu_build. A job that keeps failing stops being retried and becomes 'needs_attention' for an
-- admin or owner to act on (an admin override link, an image upload, ...); adding a menu any other way clears it
-- (resolve_place_menu_build).
--
-- Retry rules, for both kinds: an error waits 6 hours; no menu link / unreadable page waits 72 hours; after
-- menuBuildMaxAttempts failed tries the job becomes needs_attention. A built job is due again after its refresh
-- period (placeMenuRefreshDays for places, serpapiMenuRefreshDays for chains).
--
-- Everything here is service-role only (the edge functions and the scheduled job). Safe to re-run.

-- ── 1. Settings (not secret; app_config is publicly readable) ───────────────
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('placeMenuRefreshDays', '90', 'Days before an independent restaurant''s built menu is looked up again (1-365).', 'Edge function: no env equivalent, DB-only'),
  ('menuBuildMaxAttempts', '3', 'Failed tries before a menu build stops retrying and is flagged for an admin or owner (1-10).', 'Edge function: no env equivalent, DB-only'),
  ('menuQueueMaxWaiting', '5000', 'Most menu builds that can be waiting at once; beyond this, new requests are ignored until the queue shrinks.', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

-- A whole-number setting with a default and bounds.
CREATE OR REPLACE FUNCTION public._menu_setting(p_key TEXT, p_default INTEGER, p_min INTEGER, p_max INTEGER)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT LEAST(GREATEST(COALESCE(
    (SELECT CASE WHEN c.value ~ '^[0-9]{1,6}$' THEN c.value::INTEGER END FROM public.app_config c WHERE c.key = p_key),
    p_default), p_min), p_max);
$$;

REVOKE ALL ON FUNCTION public._menu_setting(TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;

-- ── 2. The queue ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_build_queue (
  id              BIGSERIAL PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('chain', 'place')),
  chain_id        UUID REFERENCES public.franchise_chains(id) ON DELETE CASCADE,
  place_id        TEXT,
  restaurant_name TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting', 'building', 'built', 'no_menu_link', 'unreadable', 'error', 'needs_attention')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_detail     TEXT,
  -- how many times customers opened it while it had no menu: the build order (busiest first)
  requested_count INTEGER NOT NULL DEFAULT 1,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT menu_build_queue_ids CHECK (
    (kind = 'chain' AND chain_id IS NOT NULL AND place_id IS NULL) OR
    (kind = 'place' AND place_id IS NOT NULL AND chain_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_build_queue_chain ON public.menu_build_queue (chain_id) WHERE kind = 'chain';
CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_build_queue_place ON public.menu_build_queue (place_id) WHERE kind = 'place';
CREATE INDEX IF NOT EXISTS idx_menu_build_queue_due ON public.menu_build_queue (status, next_attempt_at);
ALTER TABLE public.menu_build_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_build_queue FROM PUBLIC, anon, authenticated;

-- ── 3. Add a job (called when a customer opens a restaurant with no stored menu) ──
-- Returns what happened: 'queued' (new job), 'already_queued' (its request count went up),
-- 'already_built' (it already has a menu), 'unknown_place' (not in the Google cache: ignored),
-- 'invalid' (bad input), 'queue_full'.
CREATE OR REPLACE FUNCTION public.enqueue_menu_build(p_place_id TEXT, p_restaurant_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chain      UUID;
  v_chain_name TEXT;
  v_name       TEXT := btrim(COALESCE(p_restaurant_name, ''));
  v_waiting    INTEGER;
  v_inserted   BOOLEAN;
BEGIN
  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' OR v_name = '' THEN
    RETURN 'invalid';
  END IF;
  -- only places the app has really seen (they come from Google searches), so IDs cannot be invented
  IF NOT EXISTS (SELECT 1 FROM public.cached_restaurants cr WHERE cr.place_id = p_place_id) THEN
    RETURN 'unknown_place';
  END IF;

  SELECT m.id, m.name INTO v_chain, v_chain_name FROM public.find_franchise_chain(v_name) m;

  IF v_chain IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.franchise_menu_sources s WHERE s.chain_id = v_chain AND s.status = 'ok') THEN
      RETURN 'already_built';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.menu_build_queue q WHERE q.kind = 'chain' AND q.chain_id = v_chain) THEN
      SELECT COUNT(*) INTO v_waiting FROM public.menu_build_queue q WHERE q.status = 'waiting';
      IF v_waiting >= public._menu_setting('menuQueueMaxWaiting', 5000, 1, 1000000) THEN RETURN 'queue_full'; END IF;
    END IF;
    INSERT INTO public.menu_build_queue (kind, chain_id, restaurant_name)
    VALUES ('chain', v_chain, v_chain_name)
    ON CONFLICT (chain_id) WHERE kind = 'chain' DO UPDATE
      SET requested_count = public.menu_build_queue.requested_count + 1, updated_at = NOW()
    RETURNING (xmax = 0) INTO v_inserted;
    RETURN CASE WHEN v_inserted THEN 'queued' ELSE 'already_queued' END;
  END IF;

  IF EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.place_id = p_place_id) THEN
    RETURN 'already_built';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.menu_build_queue q WHERE q.kind = 'place' AND q.place_id = p_place_id) THEN
    SELECT COUNT(*) INTO v_waiting FROM public.menu_build_queue q WHERE q.status = 'waiting';
    IF v_waiting >= public._menu_setting('menuQueueMaxWaiting', 5000, 1, 1000000) THEN RETURN 'queue_full'; END IF;
  END IF;
  INSERT INTO public.menu_build_queue (kind, place_id, restaurant_name)
  VALUES ('place', p_place_id, v_name)
  ON CONFLICT (place_id) WHERE kind = 'place' DO UPDATE
    SET requested_count = public.menu_build_queue.requested_count + 1, updated_at = NOW()
  RETURNING (xmax = 0) INTO v_inserted;
  RETURN CASE WHEN v_inserted THEN 'queued' ELSE 'already_queued' END;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_menu_build(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_menu_build(TEXT, TEXT) TO service_role;

-- ── 4. Take the next jobs ───────────────────────────────────────────────────
-- Up to p_chain_limit chain jobs and p_place_limit place jobs that are due, busiest first. Marks them
-- 'building' and counts the attempt. A job stuck in 'building' for over 10 minutes (the build was cut off)
-- counts as due again. needs_attention jobs are never taken.
CREATE OR REPLACE FUNCTION public.claim_menu_builds(p_chain_limit INTEGER DEFAULT 3, p_place_limit INTEGER DEFAULT 5)
RETURNS TABLE (job_id BIGINT, kind TEXT, chain_id UUID, place_id TEXT, restaurant_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH locked AS (
    SELECT q.id, q.kind, q.requested_count, q.requested_at
    FROM public.menu_build_queue q
    WHERE (q.status IN ('waiting', 'built', 'no_menu_link', 'unreadable', 'error') AND q.next_attempt_at <= NOW())
       OR (q.status = 'building' AND q.started_at < NOW() - INTERVAL '10 minutes')
    FOR UPDATE SKIP LOCKED
  ),
  ranked AS (
    SELECT l.id, l.kind,
           ROW_NUMBER() OVER (PARTITION BY l.kind ORDER BY l.requested_count DESC, l.requested_at) AS rn
    FROM locked l
  ),
  picked AS (
    SELECT r.id FROM ranked r
    WHERE (r.kind = 'chain' AND r.rn <= GREATEST(COALESCE(p_chain_limit, 0), 0))
       OR (r.kind = 'place' AND r.rn <= GREATEST(COALESCE(p_place_limit, 0), 0))
  ),
  upd AS (
    UPDATE public.menu_build_queue q
    SET status = 'building', started_at = NOW(), attempts = q.attempts + 1, updated_at = NOW()
    FROM picked
    WHERE q.id = picked.id
    RETURNING q.id, q.kind, q.chain_id, q.place_id, q.restaurant_name
  )
  SELECT u.id, u.kind, u.chain_id, u.place_id, u.restaurant_name FROM upd u;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_menu_builds(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_menu_builds(INTEGER, INTEGER) TO service_role;

-- ── 5. Report a result ──────────────────────────────────────────────────────
-- p_status: 'ok' (or 'built'), 'no_menu_link', 'unreadable' or 'error'. Returns the job's new status.
CREATE OR REPLACE FUNCTION public.finish_menu_build(p_job_id BIGINT, p_status TEXT, p_detail TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job      public.menu_build_queue%ROWTYPE;
  v_max      INTEGER := public._menu_setting('menuBuildMaxAttempts', 3, 1, 10);
  v_days     INTEGER;
  v_new      TEXT;
  v_next     TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_job FROM public.menu_build_queue WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Menu build job not found';
  END IF;

  IF p_status IN ('ok', 'built') THEN
    v_days := CASE WHEN v_job.kind = 'place'
                   THEN public._menu_setting('placeMenuRefreshDays', 90, 1, 365)
                   ELSE public._menu_setting('serpapiMenuRefreshDays', 30, 1, 365) END;
    v_new := 'built';
    v_next := NOW() + make_interval(days => v_days);
    UPDATE public.menu_build_queue
    SET status = v_new, attempts = 0, last_detail = p_detail, next_attempt_at = v_next, finished_at = NOW(), updated_at = NOW()
    WHERE id = p_job_id;
  ELSIF p_status IN ('no_menu_link', 'unreadable', 'error') THEN
    IF v_job.attempts >= v_max THEN
      v_new := 'needs_attention';
      v_next := 'infinity';
    ELSE
      v_new := p_status;
      v_next := NOW() + CASE WHEN p_status = 'error' THEN INTERVAL '6 hours' ELSE INTERVAL '72 hours' END;
    END IF;
    UPDATE public.menu_build_queue
    SET status = v_new, last_detail = p_detail, next_attempt_at = v_next, finished_at = NOW(), updated_at = NOW()
    WHERE id = p_job_id;
  ELSE
    RAISE EXCEPTION 'Unknown build result: %', p_status;
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_menu_build(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_menu_build(BIGINT, TEXT, TEXT) TO service_role;

-- ── 6. A menu was added another way: clear the flag ─────────────────────────
-- Called when an owner or admin saves a verified menu for a place (upload, text, manual entry).
CREATE OR REPLACE FUNCTION public.resolve_place_menu_build(p_place_id TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.menu_build_queue
  SET status = 'built', attempts = 0, last_detail = NULL,
      next_attempt_at = NOW() + make_interval(days => public._menu_setting('placeMenuRefreshDays', 90, 1, 365)),
      finished_at = NOW(), updated_at = NOW()
  WHERE kind = 'place' AND place_id = p_place_id
    AND status IN ('waiting', 'no_menu_link', 'unreadable', 'error', 'needs_attention');
$$;

REVOKE ALL ON FUNCTION public.resolve_place_menu_build(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_place_menu_build(TEXT) TO service_role;

-- ── 7. Try again (an admin fixed the cause) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.requeue_menu_build(p_job_id BIGINT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.menu_build_queue
  SET status = 'waiting', attempts = 0, next_attempt_at = NOW(), updated_at = NOW()
  WHERE id = p_job_id;
$$;

REVOKE ALL ON FUNCTION public.requeue_menu_build(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_menu_build(BIGINT) TO service_role;

NOTIFY pgrst, 'reload schema';

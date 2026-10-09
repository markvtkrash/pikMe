-- A customer opening an independent restaurant that has no real menu now goes to the browser crawler, not the old
-- server-side build.
--
--   click -> request_place_menu_import
--     - the owner or an admin already gave a menu link: that link is queued for the crawler (place_menu_crawl);
--     - otherwise the restaurant is put in place_menu_discovery. At the start of the crawler's next run, the menu-crawl
--       function looks the restaurant up (the existing Google / SerpApi place lookup) ONLY to find a menu link, or the
--       website as a fallback, and queues that link for the crawler with link_source 'google'.
--   Nothing is built on the server for independents any more: the scheduled job only starts franchise builds.
--   Franchises are unchanged (shared chain menu, built on the server).
--
-- Limits, so a crowd of customers cannot run up the lookup bill or hammer one restaurant:
--   menuClickRetryDays          (30)  a restaurant already tried (found nothing, or no link found) is not tried again
--                                     for this many days, however often it is opened.
--   menuClickRequestsPerDay     (50)  most NEW restaurants that may be queued for a link lookup in 24 hours.
--   menuDiscoveriesPerRun       (10)  most link lookups one crawler run makes.
--
--   place_menu_discovery        one row per restaurant waiting for / done with the link lookup. Server only.
--   request_place_menu_import   the click entry point. Returns: invalid, unknown_place, franchise, already_built,
--                               already_queued, recently_tried, needs_attention, daily_cap, queued.
--   claim_place_discoveries / finish_place_discovery / discovery_run_limit   used by the menu-crawl function.
--   request_place_crawl         now also accepts link_source 'google' (a found link). An owner's or admin's link always
--                               wins: a found link never replaces one.
--   enqueue_menu_build          independents go through request_place_menu_import; franchises unchanged.
--   run_scheduled_menu_builds   franchises only (places = 0 is still reported so the admin page keeps working).
--
-- Safe to re-run.

-- ── 1. Settings ─────────────────────────────────────────────────────────────
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('menuClickRetryDays', '30', 'Days before an independent restaurant that was already tried (no menu link found, or the page had no dishes) is tried again when a customer opens it (1-365).', 'Edge function: no env equivalent, DB-only'),
  ('menuClickRequestsPerDay', '50', 'Most new independent restaurants that customer clicks may queue for a menu link lookup in 24 hours (1-100000). Beyond this, clicks are ignored until the next day.', 'Edge function: no env equivalent, DB-only'),
  ('menuDiscoveriesPerRun', '10', 'Most menu link lookups (Google place lookups, one SerpApi call each) one crawler run makes (1-200).', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

CREATE OR REPLACE FUNCTION public.discovery_run_limit()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._menu_setting('menuDiscoveriesPerRun', 10, 1, 200);
$$;

REVOKE ALL ON FUNCTION public.discovery_run_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discovery_run_limit() TO service_role;

-- ── 2. The crawl table accepts a found link ─────────────────────────────────
ALTER TABLE public.place_menu_crawl DROP CONSTRAINT IF EXISTS place_menu_crawl_link_source_check;
ALTER TABLE public.place_menu_crawl
  ADD CONSTRAINT place_menu_crawl_link_source_check CHECK (link_source IN ('owner', 'admin', 'google'));

-- ── 3. The lookup table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.place_menu_discovery (
  place_id        TEXT PRIMARY KEY,
  restaurant_name TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'looking', 'found', 'none', 'error')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  found_link      TEXT,
  last_detail     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_place_menu_discovery_due ON public.place_menu_discovery (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_place_menu_discovery_requested ON public.place_menu_discovery (requested_at);
ALTER TABLE public.place_menu_discovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.place_menu_discovery FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.place_menu_discovery TO service_role;

-- ── 4. request_place_crawl: also 'google' ───────────────────────────────────
-- 'owner_or_admin_link': a found link is ignored while the owner or an admin has a link of their own.
CREATE OR REPLACE FUNCTION public.request_place_crawl(p_place_id TEXT, p_name TEXT, p_link TEXT, p_source TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link TEXT := btrim(COALESCE(p_link, ''));
  v_name TEXT := btrim(COALESCE(p_name, ''));
BEGIN
  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' OR v_name = ''
     OR length(v_link) > 2000 OR v_link !~* '^https?://[^[:space:]]{4,}$'   -- (a regex repeat count is limited to 255)
     OR p_source NOT IN ('owner', 'admin', 'google') THEN
    RETURN 'invalid';
  END IF;
  IF public.is_franchise_chain(v_name) THEN
    RETURN 'franchise';
  END IF;
  -- an admin's override link wins over the owner's link
  IF p_source = 'owner' AND EXISTS (
    SELECT 1 FROM public.menu_build_queue q
    WHERE q.kind = 'place' AND q.place_id = p_place_id AND q.override_link IS NOT NULL AND btrim(q.override_link) <> ''
  ) THEN
    RETURN 'admin_link_in_use';
  END IF;
  -- a link found on Google never replaces one the owner or an admin gave
  IF p_source = 'google' AND (
    EXISTS (
      SELECT 1 FROM public.menu_build_queue q
      WHERE q.kind = 'place' AND q.place_id = p_place_id AND q.override_link IS NOT NULL AND btrim(q.override_link) <> ''
    )
    OR EXISTS (
      SELECT 1 FROM public.place_menu_crawl c WHERE c.place_id = p_place_id AND c.link_source IN ('owner', 'admin')
    )
  ) THEN
    RETURN 'owner_or_admin_link';
  END IF;

  INSERT INTO public.place_menu_crawl (place_id, restaurant_name, link, link_source)
  VALUES (p_place_id, v_name, v_link, p_source)
  ON CONFLICT (place_id) DO UPDATE
    SET restaurant_name = EXCLUDED.restaurant_name,
        link            = EXCLUDED.link,
        link_source     = EXCLUDED.link_source,
        status          = 'pending',
        attempts        = 0,
        requested_at    = NOW(),
        next_attempt_at = NOW(),
        last_detail     = NULL,
        updated_at      = NOW();
  RETURN 'queued';
END;
$$;

REVOKE ALL ON FUNCTION public.request_place_crawl(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_place_crawl(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── 5. A customer opened an independent restaurant ──────────────────────────
CREATE OR REPLACE FUNCTION public.request_place_menu_import(p_place_id TEXT, p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name   TEXT := btrim(COALESCE(p_name, ''));
  v_days   INTEGER := public._menu_setting('menuClickRetryDays', 30, 1, 365);
  v_cap    INTEGER := public._menu_setting('menuClickRequestsPerDay', 50, 1, 100000);
  v_crawl  public.place_menu_crawl%ROWTYPE;
  v_disc   public.place_menu_discovery%ROWTYPE;
  v_link   TEXT;
  v_source TEXT;
  v_res    TEXT;
BEGIN
  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' OR v_name = '' THEN
    RETURN 'invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cached_restaurants cr WHERE cr.place_id = p_place_id) THEN
    RETURN 'unknown_place';
  END IF;
  IF public.is_franchise_chain(v_name) THEN
    RETURN 'franchise';
  END IF;
  -- anything that is not an AI guess is a real menu
  IF EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.place_id = p_place_id AND mi.item_id NOT LIKE 'ai\_%' ESCAPE '\'
  ) THEN
    RETURN 'already_built';
  END IF;

  -- 1. a link is already known (the crawl table, an admin override, the owner's profile)
  SELECT * INTO v_crawl FROM public.place_menu_crawl c WHERE c.place_id = p_place_id;
  IF FOUND THEN
    IF v_crawl.status IN ('pending', 'crawling', 'error') THEN RETURN 'already_queued'; END IF;
    IF v_crawl.status = 'needs_attention' THEN RETURN 'needs_attention'; END IF;
    -- done / no_items: tried before
    IF COALESCE(v_crawl.finished_at, v_crawl.updated_at) > NOW() - make_interval(days => v_days) THEN
      RETURN 'recently_tried';
    END IF;
    UPDATE public.place_menu_crawl c
       SET status = 'pending', attempts = 0, requested_at = NOW(), next_attempt_at = NOW(), last_detail = NULL, updated_at = NOW()
     WHERE c.place_id = p_place_id;
    RETURN 'queued';
  END IF;

  SELECT q.override_link, 'admin' INTO v_link, v_source
    FROM public.menu_build_queue q
   WHERE q.kind = 'place' AND q.place_id = p_place_id AND q.override_link IS NOT NULL AND btrim(q.override_link) <> ''
   LIMIT 1;
  IF v_link IS NULL THEN
    SELECT r.menu_link, 'owner' INTO v_link, v_source
      FROM public.restaurants r
     WHERE r.google_place_id = p_place_id AND r.menu_link IS NOT NULL AND btrim(r.menu_link) <> ''
     LIMIT 1;
  END IF;
  IF v_link IS NOT NULL THEN
    v_res := public.request_place_crawl(p_place_id, v_name, v_link, v_source);
    IF v_res = 'queued' THEN RETURN 'queued'; END IF;
    -- an unusable saved link: fall through to the lookup
  END IF;

  -- 2. no link: look one up (once per restaurant per menuClickRetryDays)
  SELECT * INTO v_disc FROM public.place_menu_discovery d WHERE d.place_id = p_place_id;
  IF FOUND THEN
    IF v_disc.status IN ('waiting', 'looking', 'error') THEN RETURN 'already_queued'; END IF;
    IF COALESCE(v_disc.finished_at, v_disc.updated_at) > NOW() - make_interval(days => v_days) THEN
      RETURN 'recently_tried';
    END IF;
  END IF;

  IF (SELECT COUNT(*) FROM public.place_menu_discovery d WHERE d.requested_at > NOW() - INTERVAL '24 hours') >= v_cap THEN
    RETURN 'daily_cap';
  END IF;

  INSERT INTO public.place_menu_discovery (place_id, restaurant_name)
  VALUES (p_place_id, v_name)
  ON CONFLICT (place_id) DO UPDATE
    SET restaurant_name = EXCLUDED.restaurant_name,
        status = 'waiting', attempts = 0, requested_at = NOW(), next_attempt_at = NOW(),
        found_link = NULL, last_detail = NULL, updated_at = NOW();
  RETURN 'queued';
END;
$$;

REVOKE ALL ON FUNCTION public.request_place_menu_import(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_place_menu_import(TEXT, TEXT) TO service_role;

-- ── 6. The link lookup: hand out, record ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_place_discoveries(p_limit INTEGER DEFAULT 3)
RETURNS TABLE (job_place_id TEXT, job_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT d.place_id
    FROM public.place_menu_discovery d
    WHERE (d.status IN ('waiting', 'error') AND d.next_attempt_at <= NOW())
       OR (d.status = 'looking' AND d.claimed_at < NOW() - INTERVAL '30 minutes')
    ORDER BY d.requested_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), public.discovery_run_limit())
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.place_menu_discovery d
     SET status = 'looking', claimed_at = NOW(), attempts = d.attempts + 1, updated_at = NOW()
    FROM picked
   WHERE d.place_id = picked.place_id
  RETURNING d.place_id, d.restaurant_name;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_place_discoveries(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_place_discoveries(INTEGER) TO service_role;

-- p_status: 'found' (p_link is the link to read: queued for the crawler), 'none' (the lookup worked but gave no usable
-- link) or 'error' (the lookup itself failed: retried after 6 hours, and after menuBuildMaxAttempts failures it is
-- recorded as 'none'). Returns the new status, or 'unknown'.
CREATE OR REPLACE FUNCTION public.finish_place_discovery(
  p_place_id TEXT, p_status TEXT, p_link TEXT DEFAULT NULL, p_detail TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.place_menu_discovery%ROWTYPE;
  v_max INTEGER := public._menu_setting('menuBuildMaxAttempts', 3, 1, 10);
  v_res TEXT;
BEGIN
  SELECT * INTO v_row FROM public.place_menu_discovery d WHERE d.place_id = p_place_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;

  IF p_status = 'found' AND p_link IS NOT NULL THEN
    v_res := public.request_place_crawl(p_place_id, v_row.restaurant_name, p_link, 'google');
    IF v_res IN ('queued', 'owner_or_admin_link') THEN
      UPDATE public.place_menu_discovery d
         SET status = 'found', found_link = LEFT(p_link, 2000), last_detail = LEFT(COALESCE(p_detail, v_res), 300),
             finished_at = NOW(), updated_at = NOW()
       WHERE d.place_id = p_place_id;
      RETURN 'found';
    END IF;
    -- the link was refused (not a web address, or a franchise): same as no link
    UPDATE public.place_menu_discovery d
       SET status = 'none', last_detail = LEFT('link refused: ' || v_res, 300), finished_at = NOW(), updated_at = NOW()
     WHERE d.place_id = p_place_id;
    RETURN 'none';
  ELSIF p_status = 'error' THEN
    IF v_row.attempts >= v_max THEN
      UPDATE public.place_menu_discovery d
         SET status = 'none', last_detail = LEFT(COALESCE(p_detail, 'lookup failed'), 300), finished_at = NOW(), updated_at = NOW()
       WHERE d.place_id = p_place_id;
      RETURN 'none';
    END IF;
    UPDATE public.place_menu_discovery d
       SET status = 'error', last_detail = LEFT(COALESCE(p_detail, 'lookup failed'), 300),
           next_attempt_at = NOW() + INTERVAL '6 hours', updated_at = NOW()
     WHERE d.place_id = p_place_id;
    RETURN 'error';
  ELSE
    UPDATE public.place_menu_discovery d
       SET status = 'none', last_detail = LEFT(COALESCE(p_detail, 'no menu link found'), 300),
           finished_at = NOW(), updated_at = NOW()
     WHERE d.place_id = p_place_id;
    RETURN 'none';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_place_discovery(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_place_discovery(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── 7. A customer click: independents go to the crawler ─────────────────────
-- As migration 113, except the independent branch, which delegates to request_place_menu_import. The old place queue
-- (menu_build_queue kind 'place') is no longer filled by clicks; rows already in it are left alone.
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
  v_marked     INTEGER;
BEGIN
  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' OR v_name = '' THEN
    RETURN 'invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cached_restaurants cr WHERE cr.place_id = p_place_id) THEN
    RETURN 'unknown_place';
  END IF;

  SELECT m.id, m.name INTO v_chain, v_chain_name FROM public.find_franchise_chain(v_name) m;

  IF v_chain IS NULL THEN
    RETURN public.request_place_menu_import(p_place_id, v_name);
  END IF;

  -- a chain with no real items whose last build is old enough to retry is due again
  v_marked := public.mark_empty_chains_due(v_chain);
  IF v_marked = 0 AND EXISTS (SELECT 1 FROM public.franchise_menu_sources s WHERE s.chain_id = v_chain AND s.status = 'ok') THEN
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
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_menu_build(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_menu_build(TEXT, TEXT) TO service_role;

-- ── 8. The scheduled job: franchises only ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_scheduled_menu_builds()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'chains', public._start_chain_menu_builds('scheduled'),
    'places', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_menu_builds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_scheduled_menu_builds() TO service_role;

NOTIFY pgrst, 'reload schema';

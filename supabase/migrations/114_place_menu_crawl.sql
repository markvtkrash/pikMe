-- Browser crawl of an independent restaurant's menu link (the Python worker on the VPS).
--
-- When an owner saves a menu link on their profile, or an admin sets an override link for a restaurant, that
-- restaurant is recorded here as "needs crawling". The worker (crawler/crawl_places.py, started by cron on the VPS)
-- asks the menu-crawl edge function for the next ones, reads the page in a real browser, and sends back the dish
-- names it found; the server estimates nutrition and merges them into THAT restaurant's menu (by its Google place
-- ID) with the usual rules: new dishes are added verified, matching AI guesses become verified, nothing is replaced.
--
--   place_menu_crawl            one row per restaurant: the link to read, where it came from, and how the crawl went.
--                               Only the server reads or writes it.
--   request_place_crawl         records "read this link" (owner or admin). Franchises are skipped; an owner's link is
--                               ignored while an admin override link is in force (the admin's link wins).
--   triggers                    EVERY owner save that sets the menu link on restaurants (the Save button of the menu page
--                               URL on the owner's Menu Management page; the same address counts, because the page
--                               behind it may have changed), and every
--                               admin save of an override link on menu_build_queue, calls request_place_crawl. The
--                               worker, run daily by cron, then reads everything that is waiting. A failure here never
--                               blocks the save.
--   claim_place_crawls          hands the worker its next restaurants (and takes them, so two runs never share one),
--                               never more than menuCrawlMaxPerRun (an app_config setting) in one run.
--   crawl_run_limit             that setting, read by the edge function so the worker can say why it stopped.
--   finish_place_crawl          records the result: ok / no_items (the page was read but had no dishes) / error.
--                               An error is retried after 6 hours, and after menuBuildMaxAttempts failures it is
--                               flagged needs_attention. A result for an out-of-date link, or for a restaurant saved
--                               again while it was being read, is ignored: the newer request is crawled instead.
--   crawler_secret_ok           checks the worker's secret (internal_settings key crawler_secret, at least 24 characters).
--
-- Everything is service-role only. Safe to re-run.

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.place_menu_crawl (
  place_id        TEXT PRIMARY KEY,
  restaurant_name TEXT NOT NULL,
  link            TEXT NOT NULL,
  link_source     TEXT NOT NULL CHECK (link_source IN ('owner', 'admin')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'crawling', 'done', 'no_items', 'error', 'needs_attention')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  last_detail     TEXT,
  last_item_count INTEGER,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_place_menu_crawl_due ON public.place_menu_crawl (status, next_attempt_at);
ALTER TABLE public.place_menu_crawl ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.place_menu_crawl FROM PUBLIC, anon, authenticated;
-- The edge functions use the service role. A table created in the SQL editor does not give it access by itself, so it
-- is granted here (as migration 072 does for franchise_menu_sources): without this the menu-crawl function fails with
-- "permission denied for table place_menu_crawl".
GRANT ALL ON public.place_menu_crawl TO service_role;
-- get-chain-menu reads menu_build_queue (an admin's override link) with the service role as well, and migration 101
-- never granted it; without the grant that read fails and the override link is silently ignored. Safe to repeat.
GRANT ALL ON public.menu_build_queue TO service_role;

-- ── 2. Record "read this link" ──────────────────────────────────────────────
-- Returns: 'queued', 'invalid', 'franchise' (a chain has one shared menu) or 'admin_link_in_use'.
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
     OR p_source NOT IN ('owner', 'admin') THEN
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

-- ── 3. Triggers: an owner's new link, an admin's override link ──────────────
CREATE OR REPLACE FUNCTION public._trg_owner_menu_link_crawl()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    -- fires on every save that sets menu_link (the owner's menu page URL Save button), even to the same address:
    -- the page behind a link can change without the link changing, and a save is the owner asking for a fresh read
    IF NEW.google_place_id IS NOT NULL AND NEW.menu_link IS NOT NULL AND btrim(NEW.menu_link) <> '' THEN
      PERFORM public.request_place_crawl(NEW.google_place_id, NEW.name, NEW.menu_link, 'owner');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- recording the crawl must never block saving the restaurant
    RAISE WARNING 'place_menu_crawl: could not record the owner menu link: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owner_menu_link_crawl ON public.restaurants;
CREATE TRIGGER trg_owner_menu_link_crawl
  AFTER INSERT OR UPDATE OF menu_link ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public._trg_owner_menu_link_crawl();

CREATE OR REPLACE FUNCTION public._trg_admin_override_link_crawl()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    -- fires whenever the override link is SET (even to the same address: an admin saving it again asks for a re-read)
    IF NEW.kind = 'place' AND NEW.override_link IS NOT NULL AND btrim(NEW.override_link) <> '' THEN
      PERFORM public.request_place_crawl(NEW.place_id, NEW.restaurant_name, NEW.override_link, 'admin');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'place_menu_crawl: could not record the admin override link: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_override_link_crawl ON public.menu_build_queue;
CREATE TRIGGER trg_admin_override_link_crawl
  AFTER INSERT OR UPDATE OF override_link ON public.menu_build_queue
  FOR EACH ROW EXECUTE FUNCTION public._trg_admin_override_link_crawl();

-- ── 4. The most restaurants one run may read (an app_config setting) ─────────
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('menuCrawlMaxPerRun', '50', 'Most restaurants the browser crawl worker reads in one run (1-1000). The worker runs once a day; restaurants beyond this wait for the next run, oldest request first. Takes effect on the worker''s next request.', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

CREATE OR REPLACE FUNCTION public.crawl_run_limit()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._menu_setting('menuCrawlMaxPerRun', 50, 1, 1000);
$$;

REVOKE ALL ON FUNCTION public.crawl_run_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crawl_run_limit() TO service_role;

-- ── 5. Hand the worker its next restaurants ─────────────────────────────────
-- Pending ones, and errors whose retry time has come, oldest request first. A crawl that has been "crawling" for over
-- 30 minutes (the worker died) is given out again. At most 20 at a time, and never more than the run limit allows:
-- p_taken is how many this run has already taken, and nothing is handed out once it reaches menuCrawlMaxPerRun.
DROP FUNCTION IF EXISTS public.claim_place_crawls(INTEGER);

CREATE OR REPLACE FUNCTION public.claim_place_crawls(p_limit INTEGER DEFAULT 3, p_taken INTEGER DEFAULT 0)
RETURNS TABLE (job_place_id TEXT, job_name TEXT, job_link TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room INTEGER := GREATEST(public._menu_setting('menuCrawlMaxPerRun', 50, 1, 1000) - GREATEST(COALESCE(p_taken, 0), 0), 0);
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT c.place_id
    FROM public.place_menu_crawl c
    WHERE (c.status IN ('pending', 'error') AND c.next_attempt_at <= NOW())
       OR (c.status = 'crawling' AND c.claimed_at < NOW() - INTERVAL '30 minutes')
    ORDER BY c.requested_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 20, v_room)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.place_menu_crawl c
     SET status = 'crawling', claimed_at = NOW(), attempts = c.attempts + 1, updated_at = NOW()
    FROM picked
   WHERE c.place_id = picked.place_id
  RETURNING c.place_id, c.restaurant_name, c.link;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_place_crawls(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_place_crawls(INTEGER, INTEGER) TO service_role;

-- ── 6. Record the result ────────────────────────────────────────────────────
-- p_status: 'ok' (dishes were found and merged), 'no_items' (the page was read but had no dishes) or 'error'.
-- Returns the new status, 'link_changed' (the link was changed while it was being read: the newer link stays queued),
-- 'requested_again' (saved again while it was being read: the newer request stays queued) or 'unknown'.
CREATE OR REPLACE FUNCTION public.finish_place_crawl(
  p_place_id TEXT, p_link TEXT, p_status TEXT, p_detail TEXT DEFAULT NULL, p_items INTEGER DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.place_menu_crawl%ROWTYPE;
  v_max INTEGER := public._menu_setting('menuBuildMaxAttempts', 3, 1, 10);
  v_new TEXT;
BEGIN
  SELECT * INTO v_row FROM public.place_menu_crawl c WHERE c.place_id = p_place_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF v_row.link IS DISTINCT FROM p_link THEN RETURN 'link_changed'; END IF;
  -- the owner or an admin saved again while this crawl was running: that newer request stays queued
  IF v_row.requested_at > COALESCE(v_row.claimed_at, '-infinity'::timestamptz) THEN RETURN 'requested_again'; END IF;

  IF p_status = 'ok' THEN
    UPDATE public.place_menu_crawl c
       SET status = 'done', attempts = 0, last_detail = LEFT(p_detail, 300), last_item_count = p_items,
           finished_at = NOW(), updated_at = NOW()
     WHERE c.place_id = p_place_id;
    RETURN 'done';
  ELSIF p_status = 'no_items' THEN
    UPDATE public.place_menu_crawl c
       SET status = 'no_items', last_detail = LEFT(p_detail, 300), last_item_count = 0,
           finished_at = NOW(), updated_at = NOW()
     WHERE c.place_id = p_place_id;
    RETURN 'no_items';
  ELSE
    v_new := CASE WHEN v_row.attempts >= v_max THEN 'needs_attention' ELSE 'error' END;
    UPDATE public.place_menu_crawl c
       SET status = v_new, last_detail = LEFT(p_detail, 300),
           next_attempt_at = CASE WHEN v_new = 'error' THEN NOW() + INTERVAL '6 hours' ELSE 'infinity' END,
           finished_at = NOW(), updated_at = NOW()
     WHERE c.place_id = p_place_id;
    RETURN v_new;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_place_crawl(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_place_crawl(TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- ── 7. The worker's secret ──────────────────────────────────────────────────
-- Compared as hashes. A missing, blank or short (under 24 characters) stored secret never matches.
CREATE OR REPLACE FUNCTION public.crawler_secret_ok(p_secret TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stored TEXT;
BEGIN
  SELECT s.value INTO v_stored FROM public.internal_settings s WHERE s.key = 'crawler_secret';
  IF v_stored IS NULL OR length(btrim(v_stored)) < 24 OR p_secret IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN sha256(convert_to(p_secret, 'UTF8')) = sha256(convert_to(btrim(v_stored), 'UTF8'));
END;
$$;

REVOKE ALL ON FUNCTION public.crawler_secret_ok(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crawler_secret_ok(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

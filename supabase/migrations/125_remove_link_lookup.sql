-- No outside lookup finds a menu link for an independent restaurant any more.
--
-- Migration 118 let a customer's click on an independent restaurant with no link queue a Google (SerpApi) lookup for a menu
-- link or website. That is removed. A click now does only this:
--   - a link is already known (the crawl record, an admin link, the owner's profile link): it is queued for the browser
--     crawler, subject to menuClickRetryDays;
--   - no link is known: nothing is queued. The restaurant is already recorded by migration 119 (place_menu_clicks), so it
--     shows in the admin's "opened with no confirmed menu item" list, where an admin adds a link or uploads the menu.
--
--   request_place_menu_import   as migration 118 without the lookup; returns 'no_link' when there is no usable link.
--   admin_list_unconfirmed_clicked_restaurants  as migration 119 without the lookup table (crawl_state is the crawler's
--                               status, or NULL when no link is known).
--   dropped                     place_menu_discovery, claim_place_discoveries, finish_place_discovery, discovery_run_limit,
--                               and the settings menuDiscoveriesPerRun and menuClickRequestsPerDay (the daily cap guarded
--                               the lookup bill). menuClickRetryDays stays.
--
-- (The link source 'google' stays allowed on place_menu_crawl: it is harmless and unused.) Safe to re-run.

-- ── 1. The click: no lookup ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_place_menu_import(p_place_id TEXT, p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name   TEXT := btrim(COALESCE(p_name, ''));
  v_days   INTEGER := public._menu_setting('menuClickRetryDays', 30, 1, 365);
  v_crawl  public.place_menu_crawl%ROWTYPE;
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

  -- 1. a crawl record already exists
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

  -- 2. a link is known: an admin's, else the owner's
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
  END IF;

  -- 3. no usable link: nothing to read. The click is already recorded (place_menu_clicks), so the admin sees it.
  RETURN 'no_link';
END;
$$;

REVOKE ALL ON FUNCTION public.request_place_menu_import(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_place_menu_import(TEXT, TEXT) TO service_role;

-- ── 2. The admin list without the lookup table ──────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_unconfirmed_clicked_restaurants(INTEGER, INTEGER);

CREATE FUNCTION public.admin_list_unconfirmed_clicked_restaurants(p_limit INTEGER DEFAULT 25, p_offset INTEGER DEFAULT 0)
RETURNS TABLE (
  total_count     BIGINT,
  place_id        TEXT,
  restaurant_name TEXT,
  address         TEXT,
  city            TEXT,
  click_count     INTEGER,
  last_clicked_at TIMESTAMPTZ,
  claimed         BOOLEAN,
  crawl_state     TEXT,
  crawl_detail    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  WITH open_list AS (
    SELECT k.place_id AS pid, k.restaurant_name AS rname, k.click_count AS clicks, k.last_clicked_at AS last_at
    FROM public.place_menu_clicks k
    WHERE NOT EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.place_id = k.place_id AND mi.is_verified)
  )
  SELECT
    COUNT(*) OVER ()::BIGINT,
    o.pid,
    o.rname,
    cr.address,
    cr.city,
    o.clicks,
    o.last_at,
    EXISTS (SELECT 1 FROM public.restaurants r WHERE r.google_place_id = o.pid),
    c.status,
    c.last_detail
  FROM open_list o
  LEFT JOIN public.cached_restaurants cr ON cr.place_id = o.pid
  LEFT JOIN public.place_menu_crawl c ON c.place_id = o.pid
  ORDER BY o.clicks DESC, o.last_at DESC, o.rname
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_unconfirmed_clicked_restaurants(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_unconfirmed_clicked_restaurants(INTEGER, INTEGER) TO authenticated;

-- ── 3. Remove the lookup ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.claim_place_discoveries(INTEGER);
DROP FUNCTION IF EXISTS public.finish_place_discovery(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.discovery_run_limit();
DROP TABLE IF EXISTS public.place_menu_discovery;
DELETE FROM public.app_config WHERE key IN ('menuDiscoveriesPerRun', 'menuClickRequestsPerDay');

NOTIFY pgrst, 'reload schema';

-- Restaurants customers opened that have no confirmed menu item: the admin's list of restaurants nobody has looked after.
--
-- A restaurant whose menu has no verified item (nothing at all, or only AI guesses, or items an admin un-confirmed) has
-- not been seen or cared for by its owner. When a customer opens one, it is recorded here, and the admin lists them
-- (Tools -> Scheduled Builds) to upload a menu. A restaurant drops off the list by itself as soon as it has one
-- verified item, however that came about: the list is worked out from the menu items each time.
--
--   place_menu_clicks                         one row per independent restaurant: name, how often it was opened, first and
--                                             last time. Only written when the restaurant has no verified item.
--   record_unconfirmed_click(place, name)     the write; never raises, so it can never break a customer's click.
--   enqueue_menu_build                        as migration 118, plus recording the click for independents.
--   admin_list_unconfirmed_clicked_restaurants(limit, offset)
--                                             admin only: a page of the list, most opened first, with the total, whether
--                                             the restaurant has an owner, and what the crawler did with it.
--
-- Franchises are not recorded (one shared menu each). Safe to re-run.

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.place_menu_clicks (
  place_id         TEXT PRIMARY KEY,
  restaurant_name  TEXT NOT NULL,
  click_count      INTEGER NOT NULL DEFAULT 1,
  first_clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_clicked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_place_menu_clicks_rank ON public.place_menu_clicks (click_count DESC, last_clicked_at DESC);
ALTER TABLE public.place_menu_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.place_menu_clicks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.place_menu_clicks TO service_role;

-- ── 2. Record a click ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_unconfirmed_click(p_place_id TEXT, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF p_place_id IS NULL OR btrim(COALESCE(p_name, '')) = '' THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.place_id = p_place_id AND mi.is_verified) THEN RETURN; END IF;
    INSERT INTO public.place_menu_clicks (place_id, restaurant_name)
    VALUES (p_place_id, btrim(p_name))
    ON CONFLICT (place_id) DO UPDATE
      SET click_count = public.place_menu_clicks.click_count + 1,
          restaurant_name = EXCLUDED.restaurant_name,
          last_clicked_at = NOW();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'place_menu_clicks: could not record the click: %', SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.record_unconfirmed_click(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_unconfirmed_click(TEXT, TEXT) TO service_role;

-- ── 3. A customer click records it (independents) ───────────────────────────
-- As migration 118, plus the record call in the independent branch.
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
    PERFORM public.record_unconfirmed_click(p_place_id, v_name);
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

-- ── 4. The admin's list ─────────────────────────────────────────────────────
-- crawl_state: what the browser crawler did (pending / crawling / done / no_items / error / needs_attention), else the
-- link lookup (lookup_waiting / lookup_looking / lookup_found / lookup_none / lookup_error), else NULL.
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
    COALESCE(c.status, 'lookup_' || d.status),
    COALESCE(c.last_detail, d.last_detail)
  FROM open_list o
  LEFT JOIN public.cached_restaurants cr ON cr.place_id = o.pid
  LEFT JOIN public.place_menu_crawl c ON c.place_id = o.pid
  LEFT JOIN public.place_menu_discovery d ON d.place_id = o.pid
  ORDER BY o.clicks DESC, o.last_at DESC, o.rname
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_unconfirmed_clicked_restaurants(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_unconfirmed_clicked_restaurants(INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

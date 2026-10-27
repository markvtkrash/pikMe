-- Menu agent: queue a restaurant automatically when a customer opens it and it has no verified menu item (nothing, or
-- only AI guesses).
--
--   request_menu_agent_for_place(place, name)   finds the best start URL we already know and calls request_menu_agent_job.
--                                               Never raises, so it can never break a customer's click. Returns:
--                                               disabled, no_url, recently_tried, queue_full, or request_menu_agent_job's result
--                                               (bad_input, franchise, has_menu, already_open, queued), or 'error'.
--                                               The fetch-menu-items-ai function calls it on a customer click (independents only).
--
-- Needs only migration 160. The URL sources (menu_build_queue 101, place_menu_crawl 114, restaurants, place_menu_discovery 118)
-- are each skipped if their table does not exist, and the two settings fall back to their defaults (30 days, 5000 waiting).
-- A restaurant usually has NO known URL on its first click; migration 162 (needs 118) also queues it once the Google link
-- lookup finds its website.
--
-- Start URL, first known wins: admin override link, the crawler's link (owner / admin / Google), the owner's menu link,
-- the link the Google lookup found.
--
-- Limits: a restaurant that already had an agent job in the last menuClickRetryDays (30) is not queued again, however often
-- it is opened; at most menuQueueMaxWaiting (5000) jobs wait at once. The master switch menuAgentEnabled, the daily caps and
-- the 'proposals need admin approval' rule of migration 160 all still apply.
--
-- Safe to re-run.

-- ── 1. Ask the agent for a restaurant ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_menu_agent_for_place(p_place_id TEXT, p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(public._menu_agent_limit('menuClickRetryDays'), 30), 1), 365)::INTEGER;
  v_url  TEXT;
  v_cand TEXT;
  v_i    INTEGER;
BEGIN
  IF NOT public.menu_agent_enabled() THEN RETURN 'disabled'; END IF;

  -- The first usable address wins, in this order. Each source is a table from an earlier migration; a source whose table
  -- does not exist (yet) is skipped, so this works with any of them missing.
  FOR v_i IN 1..4 LOOP
    v_cand := NULL;
    IF v_i = 1 AND to_regclass('public.menu_build_queue') IS NOT NULL THEN
      EXECUTE 'SELECT override_link FROM public.menu_build_queue WHERE kind = ''place'' AND place_id = $1 AND override_link IS NOT NULL LIMIT 1'
        INTO v_cand USING p_place_id;
    ELSIF v_i = 2 AND to_regclass('public.place_menu_crawl') IS NOT NULL THEN
      EXECUTE 'SELECT link FROM public.place_menu_crawl WHERE place_id = $1 LIMIT 1' INTO v_cand USING p_place_id;
    ELSIF v_i = 3 AND to_regclass('public.restaurants') IS NOT NULL THEN
      EXECUTE 'SELECT menu_link FROM public.restaurants WHERE google_place_id = $1 AND menu_link IS NOT NULL LIMIT 1'
        INTO v_cand USING p_place_id;
    ELSIF v_i = 4 AND to_regclass('public.place_menu_discovery') IS NOT NULL THEN
      EXECUTE 'SELECT found_link FROM public.place_menu_discovery WHERE place_id = $1 LIMIT 1' INTO v_cand USING p_place_id;
    END IF;
    v_cand := btrim(COALESCE(v_cand, ''));
    IF v_cand <> '' AND length(v_cand) <= 2000 AND v_cand ~* '^https?://[^[:space:]]{4,}$' THEN
      v_url := v_cand;
      EXIT;
    END IF;
  END LOOP;
  IF v_url IS NULL THEN RETURN 'no_url'; END IF;

  -- tried recently (any outcome): do not spend on it again yet
  IF EXISTS (
    SELECT 1 FROM public.menu_agent_jobs j
    WHERE j.place_id = p_place_id AND j.requested_at > NOW() - make_interval(days => v_days)
  ) THEN
    RETURN 'recently_tried';
  END IF;

  IF (SELECT COUNT(*) FROM public.menu_agent_jobs j WHERE j.status = 'pending')
       >= COALESCE(public._menu_agent_limit('menuQueueMaxWaiting'), 5000) THEN
    RETURN 'queue_full';
  END IF;

  RETURN public.request_menu_agent_job(p_place_id, p_name, btrim(v_url));
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'request_menu_agent_for_place: %', SQLERRM;
  RETURN 'error';
END;
$$;

REVOKE ALL ON FUNCTION public.request_menu_agent_for_place(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_menu_agent_for_place(TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

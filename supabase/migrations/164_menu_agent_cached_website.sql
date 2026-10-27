-- Menu agent: use the restaurant's Google website as a last-resort start URL.
--
-- request_menu_agent_for_place (migration 161) looked for a start URL in four places. A restaurant with none of them returned
-- 'no_url' and was never queued. cached_restaurants.website (migration 163: the website Google gave us) is now a fifth and
-- LAST source, so an admin's link, the crawler's link, the owner's menu link and the link lookup (migration 118, if it exists)
-- all still win over it.
--
-- Everything else is as in migration 161: same results, same limits, same switch. Safe to re-run.

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
  FOR v_i IN 1..5 LOOP
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
    ELSIF v_i = 5 AND to_regclass('public.cached_restaurants') IS NOT NULL THEN
      EXECUTE 'SELECT website FROM public.cached_restaurants WHERE place_id = $1 AND website IS NOT NULL LIMIT 1'
        INTO v_cand USING p_place_id;
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

-- A restaurant that has no real menu items is put back in line for a real build when a customer opens it.
--
-- "Real" means not an AI guess: for a franchise, the items built from the chain's menu page (chain_...); for an
-- independent, anything that is not an AI guess (ai_...). This is worked out from the items themselves each time, so
-- there is no flag to go stale however the items disappeared (admin delete, owner delete, a build that found nothing).
--
-- Before this, deleting a built menu changed nothing: a franchise's build record still said "looked up recently" and
-- an independent's queue row still said "built" (due again in 90 days), so a customer opening it got "already built"
-- or a counter bump, and "Run menu build now" found nothing waiting.
--
--   mark_empty_chains_due(chain)   marks a franchise due (its last-lookup date goes back 400 days, the same mark the
--                                  admin's "refresh on next visit" makes, so every part of the system agrees) when it
--                                  has no chain-built items and:
--                                    - its last build was "ok" (any time), or
--                                    - only when a chain is given (a customer opened it): its last build failed and the
--                                      retry delay has passed (6 hours after an error, 72 hours after no link or an
--                                      unreadable page, the same delays independents use).
--                                  A chain flagged "needs attention" or looked up in the last moments is left alone.
--                                  With no chain given it handles only the "ok" case, so a failing chain nobody opens
--                                  is never retried behind your back. Returns how many were marked.
--   enqueue_menu_build             (customer click) as migration 103, plus: a franchise marked due by the helper is
--                                  queued instead of answered "already_built"; an independent with no real items whose
--                                  queue row says "built" is set back to "waiting" (due now). Rows that failed keep
--                                  their own retry delay, and "needs attention" still needs an admin.
--   _start_chain_menu_builds       (hourly job and "Run menu build now" for franchises) as migration 097, plus marking
--                                  emptied franchises due first, so they are picked up.
--
-- Everything else is unchanged. Safe to re-run.

-- ── 1. The helper ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_empty_chains_due(p_chain_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.franchise_menu_sources s
     SET fetched_at = NOW() - INTERVAL '400 days'
    FROM public.franchise_chains fc
   WHERE fc.id = s.chain_id
     AND fc.is_active
     AND (p_chain_id IS NULL OR s.chain_id = p_chain_id)
     -- not already marked due
     AND s.fetched_at > NOW() - INTERVAL '300 days'
     -- no real (chain-built) items
     AND NOT EXISTS (
       SELECT 1 FROM public.menu_items mi
       WHERE mi.place_id IS NULL
         AND mi.restaurant_name = fc.name
         AND mi.item_id LIKE 'chain\_%' ESCAPE '\'
     )
     AND (
       s.status = 'ok'
       OR (
         p_chain_id IS NOT NULL
         AND (
           (s.status = 'error' AND s.fetched_at <= NOW() - INTERVAL '6 hours')
           OR (s.status IN ('no_menu_link', 'unreadable') AND s.fetched_at <= NOW() - INTERVAL '72 hours')
         )
       )
     )
     -- a chain that keeps failing and was flagged for an admin is not retried automatically
     AND NOT EXISTS (
       SELECT 1 FROM public.menu_build_queue q
       WHERE q.kind = 'chain' AND q.chain_id = s.chain_id AND q.status = 'needs_attention'
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_empty_chains_due(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_empty_chains_due(UUID) TO service_role;

-- ── 2. A customer opening a restaurant ──────────────────────────────────────
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
  v_rearmed    INTEGER;
BEGIN
  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' OR v_name = '' THEN
    RETURN 'invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cached_restaurants cr WHERE cr.place_id = p_place_id) THEN
    RETURN 'unknown_place';
  END IF;

  SELECT m.id, m.name INTO v_chain, v_chain_name FROM public.find_franchise_chain(v_name) m;

  IF v_chain IS NOT NULL THEN
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
  END IF;

  -- an independent that already has items other than AI guesses has a real menu
  IF EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.place_id = p_place_id AND mi.item_id NOT LIKE 'ai\_%' ESCAPE '\'
  ) THEN
    RETURN 'already_built';
  END IF;

  -- it has no real items: a job that says "built" (its menu was deleted since) is due again right now
  UPDATE public.menu_build_queue q
     SET status = 'waiting', attempts = 0, next_attempt_at = NOW(), updated_at = NOW(),
         requested_count = q.requested_count + 1
   WHERE q.kind = 'place' AND q.place_id = p_place_id AND q.status = 'built';
  GET DIAGNOSTICS v_rearmed = ROW_COUNT;
  IF v_rearmed > 0 THEN
    RETURN 'queued';
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

-- ── 3. The franchise runner (hourly job and "Run menu build now") ───────────
CREATE OR REPLACE FUNCTION public._start_chain_menu_builds(p_source TEXT)
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
    RAISE NOTICE 'chain menu builds: functions_url / service_key not set in internal_settings, nothing started';
    RETURN 0;
  END IF;

  SELECT CASE WHEN c.value ~ '^[0-9]{1,3}$' THEN LEAST(c.value::INTEGER, 20) ELSE 3 END
    INTO v_limit FROM public.app_config c WHERE c.key = 'chainMenuBuildsPerRun';
  v_limit := COALESCE(v_limit, 3);
  IF v_limit <= 0 THEN RETURN 0; END IF;

  -- keep the log short
  DELETE FROM public.chain_build_log WHERE started_at < NOW() - INTERVAL '30 days';

  -- a franchise whose built menu was emptied is due again, so it is picked up below
  PERFORM public.mark_empty_chains_due();

  FOR v_row IN SELECT * FROM public.chains_needing_menu_build(v_limit) LOOP
    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/get-chain-menu',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('chainId', v_row.chain_id),
      timeout_milliseconds := 60000
    );
    INSERT INTO public.chain_build_log (chain_id, chain_name, source) VALUES (v_row.chain_id, v_row.chain_name, COALESCE(p_source, 'scheduled'));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._start_chain_menu_builds(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._start_chain_menu_builds(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

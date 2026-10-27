-- Menu agent: also queue a restaurant when the Google link lookup (migration 118) finds its website.
--
-- A restaurant usually has NO known website on its first click, so the click alone (migration 161) queues nothing. When the link
-- lookup finds a link, finish_place_discovery now also calls request_menu_agent_for_place (migration 161).
--
-- REQUIRES migrations 118 (place_menu_discovery) and 161. Apply them first. Safe to re-run.

DO $guard$
BEGIN
  IF to_regclass('public.place_menu_discovery') IS NULL THEN
    RAISE EXCEPTION 'Migration 162 needs migration 118 (the place_menu_discovery table). Apply 118 first, or skip 162: 161 works without it.';
  END IF;
END
$guard$;


-- ── 2. A link was found: ask the agent too ──────────────────────────────────
-- As migration 118, plus one PERFORM in the 'found' branch. The agent call never raises and is ignored while the agent is off.
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
      PERFORM public.request_menu_agent_for_place(p_place_id, v_row.restaurant_name);
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

NOTIFY pgrst, 'reload schema';
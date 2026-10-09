-- The most recent menu link save wins, whoever made it, and the owner is helped when their link fails.
--
-- Before: while an admin link was set, an owner saving a new link was ignored (nothing was read). Now every save of a link
-- (the owner's profile link, an admin's link) queues a read, so the latest one is the one the crawler reads.
--
--   request_place_crawl        an owner link is no longer refused because an admin link exists. A link found online by the
--                              Google lookup still never replaces an owner or admin link.
--   override_link_ok           new, on the restaurant's queue row: whether the admin's link worked the last time it was read
--                              (true: dishes were added; false: the page had none or could not be read; NULL: not read yet).
--                              Reset to NULL whenever the admin link is saved. The admin link itself is NOT cleared when the
--                              owner saves, so it can still be suggested to the owner.
--   finish_place_crawl         as migration 114, plus recording override_link_ok after a read of the admin's link.
--   admin_get_place_menu_link  now also returns the stored admin link and whether it worked, when the link in force is the
--                              owner's (and when it was saved).
--   admin_set_place_menu_link  as migration 121, with a safer removal (only an admin crawl record is dropped).
--   owner_menu_link_help       for the signed-in owner: one row when the last read of THEIR link found no dishes or failed,
--                              with the admin's link as a suggestion only if that link worked; nothing otherwise.
--
-- Safe to re-run.

-- ── 1. Did the admin link work ──────────────────────────────────────────────
ALTER TABLE public.menu_build_queue ADD COLUMN IF NOT EXISTS override_link_ok BOOLEAN;

CREATE OR REPLACE FUNCTION public._trg_reset_override_link_ok()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.override_link_ok := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_override_link_ok ON public.menu_build_queue;
CREATE TRIGGER trg_reset_override_link_ok
  BEFORE INSERT OR UPDATE OF override_link ON public.menu_build_queue
  FOR EACH ROW EXECUTE FUNCTION public._trg_reset_override_link_ok();

-- ── 2. request_place_crawl: an owner link is queued even with an admin link ─
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
  -- a link found online never replaces one the owner or an admin gave
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

-- ── 3. finish_place_crawl: remember whether the admin link worked ───────────
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
    IF v_row.link_source = 'admin' THEN
      UPDATE public.menu_build_queue q SET override_link_ok = TRUE
       WHERE q.kind = 'place' AND q.place_id = p_place_id AND q.override_link = p_link;
    END IF;
    RETURN 'done';
  ELSIF p_status = 'no_items' THEN
    UPDATE public.place_menu_crawl c
       SET status = 'no_items', last_detail = LEFT(p_detail, 300), last_item_count = 0,
           finished_at = NOW(), updated_at = NOW()
     WHERE c.place_id = p_place_id;
    IF v_row.link_source = 'admin' THEN
      UPDATE public.menu_build_queue q SET override_link_ok = FALSE
       WHERE q.kind = 'place' AND q.place_id = p_place_id AND q.override_link = p_link;
    END IF;
    RETURN 'no_items';
  ELSE
    v_new := CASE WHEN v_row.attempts >= v_max THEN 'needs_attention' ELSE 'error' END;
    UPDATE public.place_menu_crawl c
       SET status = v_new, last_detail = LEFT(p_detail, 300),
           next_attempt_at = CASE WHEN v_new = 'error' THEN NOW() + INTERVAL '6 hours' ELSE 'infinity' END,
           finished_at = NOW(), updated_at = NOW()
     WHERE c.place_id = p_place_id;
    IF v_new = 'needs_attention' AND v_row.link_source = 'admin' THEN
      UPDATE public.menu_build_queue q SET override_link_ok = FALSE
       WHERE q.kind = 'place' AND q.place_id = p_place_id AND q.override_link = p_link;
    END IF;
    RETURN v_new;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_place_crawl(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_place_crawl(TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- ── 4. The admin's view of a restaurant's link ──────────────────────────────
-- link / source / status / detail / finished_at: the link in force (as before).
-- requested_at: when it was saved. admin_link / admin_link_ok: the admin's stored link and whether it worked (NULL: not
-- read yet), shown even when the owner's link is the one in force.
DROP FUNCTION IF EXISTS public.admin_get_place_menu_link(TEXT);

CREATE FUNCTION public.admin_get_place_menu_link(p_place_id TEXT)
RETURNS TABLE (
  link TEXT, source TEXT, status TEXT, detail TEXT, finished_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ, admin_link TEXT, admin_link_ok BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_link TEXT;
  v_admin_ok   BOOLEAN;
  v_owner_link TEXT;
BEGIN
  PERFORM public._require_admin();

  SELECT NULLIF(btrim(q.override_link), ''), q.override_link_ok INTO v_admin_link, v_admin_ok
  FROM public.menu_build_queue q WHERE q.kind = 'place' AND q.place_id = p_place_id;
  IF v_admin_link IS NULL THEN v_admin_ok := NULL; END IF;

  RETURN QUERY
  SELECT c.link, c.link_source, c.status, c.last_detail, c.finished_at, c.requested_at, v_admin_link, v_admin_ok
  FROM public.place_menu_crawl c WHERE c.place_id = p_place_id;
  IF FOUND THEN RETURN; END IF;

  IF v_admin_link IS NOT NULL THEN
    RETURN QUERY SELECT v_admin_link, 'admin'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, v_admin_link, v_admin_ok;
    RETURN;
  END IF;

  SELECT NULLIF(btrim(r.menu_link), '') INTO v_owner_link
  FROM public.restaurants r WHERE r.google_place_id = p_place_id LIMIT 1;
  IF v_owner_link IS NOT NULL THEN
    RETURN QUERY SELECT v_owner_link, 'owner'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TEXT, NULL::BOOLEAN;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_place_menu_link(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_place_menu_link(TEXT) TO authenticated;

-- ── 5. The admin saves or removes the link (migration 121, safer removal) ───
CREATE OR REPLACE FUNCTION public.admin_set_place_menu_link(p_place_id TEXT, p_link TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link  TEXT := NULLIF(btrim(COALESCE(p_link, '')), '');
  v_name  TEXT;
  v_owner TEXT;
BEGIN
  PERFORM public._require_admin();

  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' THEN
    RAISE EXCEPTION 'That restaurant has no valid place ID';
  END IF;
  IF v_link IS NOT NULL AND (length(v_link) > 2000 OR v_link ~ '\s' OR v_link !~* '^https?://[^/?#\s]+\.[^/?#\s]+') THEN
    RAISE EXCEPTION 'The menu link must be a full web address starting with http:// or https://';
  END IF;

  SELECT COALESCE(
           (SELECT cr.name FROM public.cached_restaurants cr WHERE cr.place_id = p_place_id),
           (SELECT r.name FROM public.restaurants r WHERE r.google_place_id = p_place_id LIMIT 1)
         ) INTO v_name;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;
  IF public.is_franchise_chain(v_name) THEN
    RAISE EXCEPTION 'A franchise has one shared menu: manage it in Franchise Menu Management';
  END IF;

  IF v_link IS NOT NULL THEN
    -- the triggers queue the crawl (source admin) and reset "did it work"
    INSERT INTO public.menu_build_queue (kind, place_id, restaurant_name, status, override_link)
    VALUES ('place', p_place_id, v_name, 'built', v_link)
    ON CONFLICT (place_id) WHERE kind = 'place' DO UPDATE
      SET override_link = EXCLUDED.override_link, restaurant_name = EXCLUDED.restaurant_name, updated_at = NOW();
    RETURN 'queued';
  END IF;

  -- remove the admin's link
  UPDATE public.menu_build_queue q SET override_link = NULL, updated_at = NOW()
  WHERE q.kind = 'place' AND q.place_id = p_place_id;

  -- only if the crawl record is the admin's: queue the owner's link instead, or drop the record
  IF EXISTS (SELECT 1 FROM public.place_menu_crawl c WHERE c.place_id = p_place_id AND c.link_source = 'admin') THEN
    SELECT NULLIF(btrim(r.menu_link), '') INTO v_owner FROM public.restaurants r WHERE r.google_place_id = p_place_id LIMIT 1;
    IF v_owner IS NOT NULL THEN
      PERFORM public.request_place_crawl(p_place_id, v_name, v_owner, 'owner');
    ELSE
      DELETE FROM public.place_menu_crawl c WHERE c.place_id = p_place_id AND c.link_source = 'admin';
    END IF;
  END IF;
  RETURN 'removed';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_place_menu_link(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_place_menu_link(TEXT, TEXT) TO authenticated;

-- ── 6. What the owner is told when their link failed ────────────────────────
-- One row when the last read of the signed-in owner's own link found no dishes or could not be read, and nothing has been
-- added to the menu since. suggested_link is the admin's link, only when it worked and differs from the owner's; else NULL.
-- Never anything about other restaurants, and never who set the link.
-- (dropped first: migration 124 gives this function a second column, and a function's result columns cannot be changed
-- by CREATE OR REPLACE, so re-running this migration after 124 would otherwise fail. Run 124 again afterwards.)
DROP FUNCTION IF EXISTS public.owner_menu_link_help();

CREATE FUNCTION public.owner_menu_link_help()
RETURNS TABLE (suggested_link TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN q.override_link_ok IS TRUE AND NULLIF(btrim(q.override_link), '') IS NOT NULL AND q.override_link <> r.menu_link
           THEN q.override_link
         END
  FROM public.restaurants r
  JOIN public.place_menu_crawl c ON c.place_id = r.google_place_id
  LEFT JOIN public.menu_build_queue q ON q.kind = 'place' AND q.place_id = r.google_place_id
  WHERE r.owner_id = auth.uid()
    AND r.status = 'approved'
    AND c.link_source = 'owner'
    AND c.link = r.menu_link
    AND c.status IN ('no_items', 'needs_attention')
    AND c.finished_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.menu_items mi
      WHERE mi.place_id = r.google_place_id
        AND mi.item_id NOT LIKE 'ai\_%' ESCAPE '\'
        AND mi.cached_at > c.finished_at
    )
  ORDER BY (c.status = 'needs_attention') DESC, c.finished_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.owner_menu_link_help() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_menu_link_help() TO authenticated;

NOTIFY pgrst, 'reload schema';

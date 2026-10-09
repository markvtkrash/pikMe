-- Admin control over chain menu sources (the admin "Chain Menus" page).
--
-- SerpApi's menu link comes and goes for the same place, so a chain whose lookup
-- found nothing used to be invisible and unfixable. This gives admins:
--   * a list of every active chain with the outcome of its last menu lookup,
--   * a way to enter a chain's official menu link by hand. A manual link is
--     permanent: the edge function reads it directly and does not call SerpApi
--     for that chain at all (no credit spent, nothing to go missing),
--   * a way to ask for a fresh lookup the next time a customer opens that chain.
--
-- Same pattern as the 045/063/065 admin RPCs: SECURITY DEFINER + _require_admin().
-- Safe to re-run.

-- ── 1. Manual-link flag ─────────────────────────────────────────────────────
ALTER TABLE public.franchise_menu_sources
  ADD COLUMN IF NOT EXISTS menu_link_manual BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.franchise_menu_sources.menu_link_manual IS
  'true = menu_link was entered by an admin; get-chain-menu uses it as is and never calls SerpApi for this chain.';

-- ── 2. List every active chain with its menu-source outcome ─────────────────
DROP FUNCTION IF EXISTS public.admin_list_chain_menu_sources();

CREATE FUNCTION public.admin_list_chain_menu_sources()
RETURNS TABLE (
  chain_id          UUID,
  chain_name        TEXT,
  category          TEXT,
  status            TEXT,
  status_detail     TEXT,
  menu_link         TEXT,
  store_ref         TEXT,
  menu_link_manual  BOOLEAN,
  website           TEXT,
  item_count        INTEGER,
  fetched_at        TIMESTAMPTZ,
  current_items     BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    fc.id,
    fc.name,
    fc.category,
    COALESCE(s.status, 'not_started'),
    s.status_detail,
    s.menu_link,
    s.store_ref,
    COALESCE(s.menu_link_manual, false),
    s.website,
    COALESCE(s.item_count, 0),
    s.fetched_at,
    -- Chain-sourced items currently shown to customers for this chain.
    (SELECT COUNT(*) FROM public.menu_items mi
      WHERE mi.restaurant_name = fc.name
        AND mi.place_id IS NULL
        AND mi.item_id LIKE 'chain\_%' ESCAPE '\')
  FROM public.franchise_chains fc
  LEFT JOIN public.franchise_menu_sources s ON s.chain_id = fc.id
  WHERE fc.is_active
  ORDER BY fc.name;
END;
$$;

-- ── 3. Set (or clear) a chain's menu link by hand ───────────────────────────
-- p_menu_link blank/NULL clears the manual link: the chain goes back to using
-- SerpApi. Either way the chain is marked due, so the next customer request
-- re-reads it. p_store_ref is the optional store parameter some sites need
-- (e.g. "store=034416").
CREATE OR REPLACE FUNCTION public.admin_set_chain_menu_link(
  p_chain_id   UUID,
  p_menu_link  TEXT,
  p_store_ref  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link  TEXT := NULLIF(btrim(COALESCE(p_menu_link, '')), '');
  v_ref   TEXT := NULLIF(btrim(COALESCE(p_store_ref, '')), '');
  v_host  TEXT;
BEGIN
  PERFORM public._require_admin();

  IF NOT EXISTS (SELECT 1 FROM public.franchise_chains WHERE id = p_chain_id) THEN
    RAISE EXCEPTION 'Chain not found';
  END IF;

  -- Clear: back to SerpApi.
  IF v_link IS NULL THEN
    UPDATE public.franchise_menu_sources
    SET menu_link_manual = false,
        menu_link = NULL,
        store_ref = NULL,
        menu_source = NULL,
        status = 'pending',
        status_detail = NULL,
        fetched_at = NOW() - INTERVAL '400 days'
    WHERE chain_id = p_chain_id;
    RETURN;
  END IF;

  IF length(v_link) > 2000 OR v_link ~ '\s' OR v_link !~* '^https?://[^/?#\s]+\.[^/?#\s]+' THEN
    RAISE EXCEPTION 'Menu link must be a full web address starting with http:// or https://';
  END IF;
  IF v_ref IS NOT NULL AND (length(v_ref) > 200 OR v_ref !~ '^[A-Za-z0-9_.=&%-]+$') THEN
    -- (No percent sign in the message: RAISE treats it as a placeholder.)
    RAISE EXCEPTION 'Store parameter may only contain letters, numbers and the symbols _ . = & - and the percent sign';
  END IF;

  v_host := lower(regexp_replace(substring(v_link FROM '^https?://([^/?#]+)'), '^www\.', ''));

  INSERT INTO public.franchise_menu_sources
    (chain_id, menu_link, store_ref, menu_source, menu_link_manual, status, status_detail, fetched_at)
  VALUES
    (p_chain_id, v_link, v_ref, v_host, true, 'pending', NULL, NOW() - INTERVAL '400 days')
  ON CONFLICT (chain_id) DO UPDATE SET
    menu_link = EXCLUDED.menu_link,
    store_ref = EXCLUDED.store_ref,
    menu_source = EXCLUDED.menu_source,
    menu_link_manual = true,
    status = 'pending',
    status_detail = NULL,
    fetched_at = EXCLUDED.fetched_at;
END;
$$;

-- ── 4. Ask for a fresh lookup ───────────────────────────────────────────────
-- Marks the chain's last lookup as old, so the next customer request runs it
-- again. Returns false when the chain has no lookup yet (it is already due).
CREATE OR REPLACE FUNCTION public.admin_mark_chain_menu_stale(p_chain_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  PERFORM public._require_admin();

  UPDATE public.franchise_menu_sources
  SET fetched_at = NOW() - INTERVAL '400 days'
  WHERE chain_id = p_chain_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- New functions are executable by everyone by default; keep these to signed-in
-- users (the admin check inside still decides who gets any data).
REVOKE ALL ON FUNCTION public.admin_list_chain_menu_sources() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_chain_menu_link(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_mark_chain_menu_stale(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_chain_menu_sources() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_chain_menu_link(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_chain_menu_stale(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

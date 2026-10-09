-- Menu page suggestions (093/094), part 3: approving or replacing a suggested link also makes
-- the chain ready for a fresh lookup on its next visit (or the next scheduled build run).
--
-- Why it is more than "mark due": the lookup tries a Google link first, then a link already
-- stored for the chain, and only then the built-in page. A page that worked earlier is "learned"
-- and stored as the chain's menu link, so after REPLACING the built-in page the old address
-- would still be used first. So when the stored link is the old built-in page (not one an admin
-- set by hand), it is cleared too, and the new page is tried. A manually set link, or a link
-- Google returned, is never touched.
--
-- Marking due works like the "Refresh on next visit" button (migration 078): the last lookup is
-- recorded as 400 days old. A chain with no lookup yet is already due.
--
-- Same rules as before otherwise: Approve fills only an EMPTY built-in page; Replace needs the
-- page the admin saw and a link an owner of the chain has saved. SECURITY DEFINER +
-- _require_admin(), signed-in users only. Safe to re-run.

-- ── Approve (fills an empty page) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_approve_chain_link_suggestion(p_chain_id UUID, p_link TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link TEXT := public.normalize_menu_link(p_link);
BEGIN
  PERFORM public._require_admin();

  IF v_link IS NULL OR length(v_link) > 2000 OR v_link ~ '\s' OR v_link !~* '^https?://[^/?#\s]+\.[^/?#\s]+' THEN
    RAISE EXCEPTION 'The menu page must be a full web address starting with http:// or https://';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurants r
    CROSS JOIN LATERAL public.find_franchise_chain(r.name) m
    WHERE m.id = p_chain_id AND r.status = 'approved' AND public.normalize_menu_link(r.menu_link) = v_link
  ) THEN
    RAISE EXCEPTION 'That link is no longer suggested for this chain';
  END IF;

  -- Fill only an empty built-in page; never overwrite one an admin set.
  UPDATE public.franchise_chains SET menu_url = v_link WHERE id = p_chain_id AND menu_url IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This chain already has a built-in menu page';
  END IF;

  -- Ready for a fresh lookup (the new page may now give a menu where there was none).
  UPDATE public.franchise_menu_sources SET fetched_at = NOW() - INTERVAL '400 days' WHERE chain_id = p_chain_id;
END;
$$;

-- ── Replace (swaps an existing page) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_replace_chain_link_suggestion(
  p_chain_id         UUID,
  p_link             TEXT,
  p_expected_current TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link    TEXT := public.normalize_menu_link(p_link);
  v_current TEXT;
BEGIN
  PERFORM public._require_admin();

  IF v_link IS NULL OR length(v_link) > 2000 OR v_link ~ '\s' OR v_link !~* '^https?://[^/?#\s]+\.[^/?#\s]+' THEN
    RAISE EXCEPTION 'The menu page must be a full web address starting with http:// or https://';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurants r
    CROSS JOIN LATERAL public.find_franchise_chain(r.name) m
    WHERE m.id = p_chain_id AND r.status = 'approved' AND public.normalize_menu_link(r.menu_link) = v_link
  ) THEN
    RAISE EXCEPTION 'That link is no longer suggested for this chain';
  END IF;

  SELECT fc.menu_url INTO v_current FROM public.franchise_chains fc WHERE fc.id = p_chain_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chain not found';
  END IF;

  -- The admin must have seen the page that is being replaced.
  IF public.normalize_menu_link(v_current) IS DISTINCT FROM public.normalize_menu_link(p_expected_current) THEN
    RAISE EXCEPTION 'The chain''s built-in menu page changed since you opened this list. Reload and check again';
  END IF;

  UPDATE public.franchise_chains SET menu_url = v_link WHERE id = p_chain_id;

  -- A stored link that is just the old built-in page (learned from it earlier) would be tried before
  -- the new one, so clear it. A link set by hand, or one Google returned, is left alone.
  UPDATE public.franchise_menu_sources
  SET menu_link = NULL, store_ref = NULL, menu_source = NULL
  WHERE chain_id = p_chain_id
    AND NOT COALESCE(menu_link_manual, false)
    AND v_current IS NOT NULL
    AND public.normalize_menu_link(menu_link) = public.normalize_menu_link(v_current);

  -- Ready for a fresh lookup.
  UPDATE public.franchise_menu_sources SET fetched_at = NOW() - INTERVAL '400 days' WHERE chain_id = p_chain_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_chain_link_suggestion(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_chain_link_suggestion(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_replace_chain_link_suggestion(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_replace_chain_link_suggestion(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

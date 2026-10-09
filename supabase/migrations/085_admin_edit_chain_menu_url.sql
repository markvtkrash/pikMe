-- Admins can see and edit a chain's built-in menu page (franchise_chains.menu_url,
-- migration 084) from the Chain Menus page.
--
--   1. admin_list_chain_menu_sources (078) also returns it, as the LAST column, and
--      is otherwise unchanged (same rows, same admin-only check, same ordering).
--      The return shape gains a column, so the function is dropped and recreated.
--   2. admin_set_chain_menu_url sets or clears it. It is only a fallback address
--      (used when SerpApi gives no menu link and no link is saved), so changing it
--      does NOT mark the chain due for a new lookup.
--
-- Same pattern as the other admin functions: SECURITY DEFINER + _require_admin(),
-- executable by signed-in users only (the admin check inside decides). Safe to re-run.

-- ── 1. List ─────────────────────────────────────────────────────────────────
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
  current_items     BIGINT,
  built_in_menu_url TEXT
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
        AND mi.item_id LIKE 'chain\_%' ESCAPE '\'),
    fc.menu_url
  FROM public.franchise_chains fc
  LEFT JOIN public.franchise_menu_sources s ON s.chain_id = fc.id
  WHERE fc.is_active
  ORDER BY fc.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_chain_menu_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_chain_menu_sources() TO authenticated;

-- ── 2. Set or clear ─────────────────────────────────────────────────────────
-- A blank value clears it. Only plain web addresses are accepted.
CREATE OR REPLACE FUNCTION public.admin_set_chain_menu_url(p_chain_id UUID, p_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT := NULLIF(btrim(COALESCE(p_url, '')), '');
BEGIN
  PERFORM public._require_admin();

  IF v_url IS NOT NULL AND (length(v_url) > 2000 OR v_url ~ '\s' OR v_url !~* '^https?://[^/?#\s]+\.[^/?#\s]+') THEN
    RAISE EXCEPTION 'The menu page must be a full web address starting with http:// or https://';
  END IF;

  UPDATE public.franchise_chains SET menu_url = v_url WHERE id = p_chain_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chain not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_chain_menu_url(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_chain_menu_url(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

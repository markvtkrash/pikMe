-- Menu page suggestions (093), part 2: an admin can REPLACE an existing built-in menu page with
-- a link owners suggested, as an explicit choice that shows both links.
--
--   1. admin_list_chain_link_suggestions also lists suggestions for chains that ALREADY have a
--      built-in page, when the suggested link differs from it, and returns that page as the last
--      column (current_menu_url, NULL when the chain has none). The return shape gains a column,
--      so the function is dropped and recreated; the rest is unchanged.
--   2. admin_replace_chain_link_suggestion replaces the page. It never happens by accident:
--      the admin passes the page they SAW (p_expected_current), and if the chain's page is
--      different now (someone changed it, or the list is stale) it refuses and asks to reload.
--      Only a link an owner of the chain has actually saved can be used.
--
-- admin_approve_chain_link_suggestion (093) is unchanged: it still only fills an EMPTY page.
-- SECURITY DEFINER + _require_admin(), signed-in users only, never anon. Safe to re-run.

-- ── 1. List ─────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_chain_link_suggestions();

CREATE FUNCTION public.admin_list_chain_link_suggestions()
RETURNS TABLE (
  chain_id              UUID,
  chain_name            TEXT,
  suggested_link        TEXT,
  owner_count           BIGINT,
  matches_chain_website BOOLEAN,
  chain_website         TEXT,
  current_menu_url      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  WITH raw AS (
    SELECT fc.id AS cid, fc.name AS cname, fc.menu_url AS curl,
           public.normalize_menu_link(r.menu_link) AS link, r.id AS rid
    FROM public.restaurants r
    CROSS JOIN LATERAL public.find_franchise_chain(r.name) m
    JOIN public.franchise_chains fc ON fc.id = m.id
    WHERE r.status = 'approved'
      AND (fc.menu_url IS NULL
           OR public.normalize_menu_link(fc.menu_url) IS DISTINCT FROM public.normalize_menu_link(r.menu_link))
      AND length(COALESCE(public.normalize_menu_link(r.menu_link), '')) BETWEEN 1 AND 2000
      AND public.normalize_menu_link(r.menu_link) !~ '\s'
      AND public.normalize_menu_link(r.menu_link) ~* '^https?://[^/?#\s]+\.[^/?#\s]+'
  )
  SELECT
    raw.cid,
    raw.cname,
    raw.link,
    COUNT(DISTINCT raw.rid),
    public.menu_hosts_match(public.menu_link_host(raw.link), public.menu_link_host(s.website)),
    s.website,
    raw.curl
  FROM raw
  LEFT JOIN public.franchise_menu_sources s ON s.chain_id = raw.cid
  WHERE NOT EXISTS (
    SELECT 1 FROM public.chain_link_dismissals d WHERE d.chain_id = raw.cid AND d.link = raw.link
  )
  GROUP BY raw.cid, raw.cname, raw.link, s.website, raw.curl
  ORDER BY raw.cname, COUNT(DISTINCT raw.rid) DESC, raw.link;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_chain_link_suggestions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_chain_link_suggestions() TO authenticated;

-- ── 2. Replace ──────────────────────────────────────────────────────────────
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
END;
$$;

REVOKE ALL ON FUNCTION public.admin_replace_chain_link_suggestion(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_replace_chain_link_suggestion(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

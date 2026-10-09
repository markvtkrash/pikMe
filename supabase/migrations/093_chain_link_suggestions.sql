-- Menu page suggestions for franchise chains, taken from what owners already enter.
--
-- An owner of a chain location can already save a "Menu Page URL" on their Restaurant Profile
-- (restaurants.menu_link, migration 029). For a chain that is a useful hint, but it must never
-- change the chain's menu by itself: one owner could be wrong or malicious, and the link is
-- fetched by the server and read by the AI. So owners write nothing new here. Admins get a
-- review list on the Franchise Menu Management page:
--
--   admin_list_chain_link_suggestions()      links owners saved, grouped per chain, only for chains
--                                            with NO built-in menu page yet (franchise_chains.menu_url,
--                                            migration 084). Shows how many restaurants gave the same
--                                            link and whether its site matches the chain's known website.
--   admin_approve_chain_link_suggestion()    fills the chain's built-in menu page, only when it is still
--                                            empty and the link is currently suggested; never overwrites.
--   admin_dismiss_chain_link_suggestion()    hides one link for one chain from the list.
--
-- Same pattern as the other admin functions: SECURITY DEFINER + _require_admin(), signed-in users
-- only (the admin check is inside), never anon. Safe to re-run.

-- ── 1. Helpers ──────────────────────────────────────────────────────────────
-- Same link written slightly differently counts once: fragment and trailing slashes removed.
CREATE OR REPLACE FUNCTION public.normalize_menu_link(p_url TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(regexp_replace(btrim(COALESCE(p_url, '')), '#.*$', ''), '/+$', ''), '');
$$;

-- "https://www.Example.com/menu" -> "example.com"
CREATE OR REPLACE FUNCTION public.menu_link_host(p_url TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(lower(substring(btrim(COALESCE(p_url, '')) from '^https?://([^/?#:@]+)')), '^www\.', ''), '');
$$;

-- Same site: equal hosts, or one is a subdomain of the other. NULL when either is unknown.
CREATE OR REPLACE FUNCTION public.menu_hosts_match(p_a TEXT, p_b TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_a IS NULL OR p_b IS NULL THEN NULL
    ELSE p_a = p_b OR p_a LIKE '%.' || p_b OR p_b LIKE '%.' || p_a
  END;
$$;

-- ── 2. Dismissed suggestions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chain_link_dismissals (
  chain_id     UUID NOT NULL REFERENCES public.franchise_chains(id) ON DELETE CASCADE,
  link         TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, link)
);
ALTER TABLE public.chain_link_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chain_link_dismissals FROM PUBLIC, anon, authenticated;

-- ── 3. The review list ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_chain_link_suggestions();

CREATE FUNCTION public.admin_list_chain_link_suggestions()
RETURNS TABLE (
  chain_id              UUID,
  chain_name            TEXT,
  suggested_link        TEXT,
  owner_count           BIGINT,
  matches_chain_website BOOLEAN,
  chain_website         TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  WITH raw AS (
    SELECT fc.id AS cid, fc.name AS cname, public.normalize_menu_link(r.menu_link) AS link, r.id AS rid
    FROM public.restaurants r
    CROSS JOIN LATERAL public.find_franchise_chain(r.name) m
    JOIN public.franchise_chains fc ON fc.id = m.id
    WHERE r.status = 'approved'
      AND fc.menu_url IS NULL
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
    s.website
  FROM raw
  LEFT JOIN public.franchise_menu_sources s ON s.chain_id = raw.cid
  WHERE NOT EXISTS (
    SELECT 1 FROM public.chain_link_dismissals d WHERE d.chain_id = raw.cid AND d.link = raw.link
  )
  GROUP BY raw.cid, raw.cname, raw.link, s.website
  ORDER BY raw.cname, COUNT(DISTINCT raw.rid) DESC, raw.link;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_chain_link_suggestions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_chain_link_suggestions() TO authenticated;

-- ── 4. Approve ──────────────────────────────────────────────────────────────
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

  -- Only a link an owner of this chain has actually saved can be approved here.
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
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_chain_link_suggestion(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_chain_link_suggestion(UUID, TEXT) TO authenticated;

-- ── 5. Dismiss ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_dismiss_chain_link_suggestion(p_chain_id UUID, p_link TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link TEXT := public.normalize_menu_link(p_link);
BEGIN
  PERFORM public._require_admin();
  IF v_link IS NULL THEN
    RAISE EXCEPTION 'No link to dismiss';
  END IF;
  INSERT INTO public.chain_link_dismissals (chain_id, link) VALUES (p_chain_id, v_link)
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dismiss_chain_link_suggestion(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dismiss_chain_link_suggestion(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

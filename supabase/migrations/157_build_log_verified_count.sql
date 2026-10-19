-- Recent builds (Tools -> Scheduled Builds) shows each independent restaurant's crawl outcome, but a failed one
-- ("Needs attention", "Error", etc.) gives no sense of whether the restaurant already has some verified dishes
-- from an earlier, successful crawl -- the admin had to open the restaurant to find out. Adds how many of the
-- restaurant's menu items are currently verified, alongside the outcome. Franchise ('chain') rows stay NULL: one
-- build covers many locations, so there is no single restaurant's verified count to show.
--
-- Safe to re-run.

DROP FUNCTION IF EXISTS public.admin_list_chain_build_log(INTEGER);

CREATE FUNCTION public.admin_list_chain_build_log(p_hours INTEGER DEFAULT 24)
RETURNS TABLE (
  started_at     TIMESTAMPTZ,
  chain_id       UUID,
  chain_name     TEXT,
  source         TEXT,
  outcome        TEXT,
  item_count     INTEGER,
  detail         TEXT,
  finished_at    TIMESTAMPTZ,
  kind           TEXT,
  place_id       TEXT,
  verified_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - make_interval(hours => LEAST(GREATEST(COALESCE(p_hours, 24), 1), 720));
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT b.* FROM (
    SELECT
      l.started_at,
      l.chain_id,
      l.chain_name,
      l.source,
      CASE
        WHEN s.id IS NOT NULL AND s.updated_at >= l.started_at AND s.status <> 'pending' THEN s.status
        WHEN l.started_at < NOW() - INTERVAL '10 minutes' THEN 'no_result'
        ELSE 'running'
      END AS outcome,
      COALESCE(s.item_count, 0) AS item_count,
      s.status_detail AS detail,
      CASE WHEN s.id IS NOT NULL AND s.updated_at >= l.started_at AND s.status <> 'pending' THEN s.updated_at END AS finished_at,
      'chain'::TEXT AS kind,
      NULL::TEXT AS place_id,
      NULL::INTEGER AS verified_count
    FROM public.chain_build_log l
    LEFT JOIN public.franchise_menu_sources s ON s.chain_id = l.chain_id
    WHERE l.started_at > v_cutoff

    UNION ALL

    SELECT
      COALESCE(c.claimed_at, c.requested_at),
      NULL::UUID,
      c.restaurant_name,
      c.link_source,
      CASE c.status
        WHEN 'done' THEN 'ok'
        WHEN 'pending' THEN 'waiting'
        WHEN 'crawling' THEN CASE WHEN c.claimed_at < NOW() - INTERVAL '30 minutes' THEN 'no_result' ELSE 'running' END
        ELSE c.status
      END,
      COALESCE(c.last_item_count, 0),
      c.last_detail,
      CASE WHEN c.status NOT IN ('pending', 'crawling') THEN COALESCE(c.finished_at, c.updated_at) END,
      'place'::TEXT,
      c.place_id,
      (SELECT COUNT(*)::INTEGER FROM public.menu_items mi WHERE mi.place_id = c.place_id AND mi.is_verified)
    FROM public.place_menu_crawl c
    WHERE COALESCE(c.claimed_at, c.requested_at) > v_cutoff
  ) b
  ORDER BY b.started_at DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_chain_build_log(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_chain_build_log(INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

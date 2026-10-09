-- "Recent builds" (admin: Tools -> Scheduled Builds) shows the browser crawler's reads for independent restaurants.
--
-- Until now the independent rows came from the old server-side build queue, which customer clicks no longer feed (migration
-- 118). They now come from place_menu_crawl: one row per restaurant whose menu link was read (or is waiting, or is being
-- read) in the chosen time window. The franchise rows are unchanged.
--
--   source   where the link came from: owner, admin or google (a link found online)
--   outcome  ok (dishes were added), no_items (page read, no dishes), error, needs_attention, waiting, running,
--            no_result (being read for over 30 minutes: the worker probably died)
--   place_id the restaurant's place, so the admin can open its menu editor (new column)
--
-- Safe to re-run.

DROP FUNCTION IF EXISTS public.admin_list_chain_build_log(INTEGER);

CREATE FUNCTION public.admin_list_chain_build_log(p_hours INTEGER DEFAULT 24)
RETURNS TABLE (
  started_at  TIMESTAMPTZ,
  chain_id    UUID,
  chain_name  TEXT,
  source      TEXT,
  outcome     TEXT,
  item_count  INTEGER,
  detail      TEXT,
  finished_at TIMESTAMPTZ,
  kind        TEXT,
  place_id    TEXT
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
      NULL::TEXT AS place_id
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
      c.place_id
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

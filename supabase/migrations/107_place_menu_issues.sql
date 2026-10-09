-- Independent restaurants whose menu could not be built (phase 6): the admin report and the owner message.
--
--   admin_list_place_menu_issues()          the independent restaurants whose last build failed or is flagged, most-wanted
--                                           first (the queue counts how often customers opened each one with no menu)
--   admin_set_place_override_link(job, url) an admin's menu link for one restaurant: read as is, Google is not asked;
--                                           saving it puts the restaurant back in the queue (a blank link removes it)
--   admin_requeue_place_build(job)          try again now (clears the attempts)
--   owner_menu_build_status()               what an owner of an independent restaurant is told: only whether the automatic
--                                           build failed for THEIR restaurant, never anything about others
--
-- "Needs attention" = the build failed repeatedly and stopped retrying. The other failures are listed too, with their
-- retry time, so the report shows every restaurant that has no menu because a build failed. Franchises have their own
-- report (the "Needs attention" filter on Franchise Menu Management). Safe to re-run.

-- ── 1. Admin report ─────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_place_menu_issues();

CREATE FUNCTION public.admin_list_place_menu_issues()
RETURNS TABLE (
  job_id          BIGINT,
  place_id        TEXT,
  restaurant_name TEXT,
  address         TEXT,
  city            TEXT,
  status          TEXT,
  attempts        INTEGER,
  last_detail     TEXT,
  requested_count INTEGER,
  finished_at     TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  override_link   TEXT,
  claimed         BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    q.id,
    q.place_id,
    q.restaurant_name,
    cr.address,
    cr.city,
    q.status,
    q.attempts,
    q.last_detail,
    q.requested_count,
    q.finished_at,
    CASE WHEN q.next_attempt_at = 'infinity' THEN NULL ELSE q.next_attempt_at END,
    q.override_link,
    EXISTS (SELECT 1 FROM public.restaurants r WHERE r.google_place_id = q.place_id)
  FROM public.menu_build_queue q
  LEFT JOIN public.cached_restaurants cr ON cr.place_id = q.place_id
  WHERE q.kind = 'place'
    AND q.status IN ('needs_attention', 'no_menu_link', 'unreadable', 'error')
  ORDER BY (q.status = 'needs_attention') DESC, q.requested_count DESC, q.restaurant_name
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_place_menu_issues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_place_menu_issues() TO authenticated;

-- ── 2. An admin's menu link for one restaurant ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_place_override_link(p_job_id BIGINT, p_link TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link TEXT := NULLIF(btrim(COALESCE(p_link, '')), '');
BEGIN
  PERFORM public._require_admin();

  IF v_link IS NOT NULL AND (length(v_link) > 2000 OR v_link ~ '\s' OR v_link !~* '^https?://[^/?#\s]+\.[^/?#\s]+') THEN
    RAISE EXCEPTION 'The menu link must be a full web address starting with http:// or https://';
  END IF;

  -- saving (or removing) the link puts the restaurant back in the queue to be built again
  UPDATE public.menu_build_queue
  SET override_link = v_link, status = 'waiting', attempts = 0, next_attempt_at = NOW(), updated_at = NOW()
  WHERE id = p_job_id AND kind = 'place';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant menu job not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_place_override_link(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_place_override_link(BIGINT, TEXT) TO authenticated;

-- ── 3. Try again ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_requeue_place_build(p_job_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  UPDATE public.menu_build_queue
  SET status = 'waiting', attempts = 0, next_attempt_at = NOW(), updated_at = NOW()
  WHERE id = p_job_id AND kind = 'place';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant menu job not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_requeue_place_build(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_requeue_place_build(BIGINT) TO authenticated;

-- ── 4. What an owner is told about their own restaurant ─────────────────────
-- One row when the automatic build failed for the signed-in owner's approved restaurant and it has no menu items of
-- its own (not counting AI guesses); nothing otherwise. Never reveals other restaurants.
CREATE OR REPLACE FUNCTION public.owner_menu_build_status()
RETURNS TABLE (status TEXT, detail TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.status, left(q.last_detail, 200)
  FROM public.restaurants r
  JOIN public.menu_build_queue q ON q.kind = 'place' AND q.place_id = r.google_place_id
  WHERE r.owner_id = auth.uid()
    AND r.status = 'approved'
    AND q.status IN ('needs_attention', 'no_menu_link', 'unreadable', 'error')
    AND NOT EXISTS (
      SELECT 1 FROM public.menu_items mi
      WHERE mi.place_id = r.google_place_id AND mi.item_id NOT LIKE 'ai\_%' ESCAPE '\'
    )
  ORDER BY (q.status = 'needs_attention') DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.owner_menu_build_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_menu_build_status() TO authenticated;

NOTIFY pgrst, 'reload schema';

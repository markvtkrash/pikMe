-- Anonymous usage events for the customer app, so the funnel (open, search, look at a restaurant, look at a menu, save, sign up) and how many people
-- come back after a week can be measured. Our own table: nothing goes to a third party.
--
-- Privacy by design:
--   * An event carries a random install ID made by the app on that phone. There is NO user ID, email, name, location or search text in it.
--   * Only the event names listed in _analytics_events() are accepted, and the extra details (props) are small and capped.
--   * Nobody can read or write the table directly; the app calls log_app_event, which only ever inserts one checked row.
--   * Events older than 180 days are deleted every night (purge_old_app_events, scheduled with pg_cron when it is installed).
--
--   log_app_event            the app's one call (anon and signed-in). A bad call is ignored, never an error, and one install is capped at
--                            300 events an hour so nobody can flood the table.
--   admin_analytics_summary  admin only: events and distinct installs per event, the funnel, daily active installs and week-later return.
--   purge_old_app_events     deletes old rows; returns how many.

CREATE TABLE IF NOT EXISTS public.app_events (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  install_id  TEXT NOT NULL,
  event       TEXT NOT NULL,
  props       JSONB NOT NULL DEFAULT '{}'::jsonb,
  platform    TEXT,
  app_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_events_created ON public.app_events (created_at);
CREATE INDEX IF NOT EXISTS idx_app_events_event ON public.app_events (event, created_at);
CREATE INDEX IF NOT EXISTS idx_app_events_install ON public.app_events (install_id, created_at);

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.app_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.app_events_id_seq TO service_role;

-- The events the app may send. The app keeps the same list (user/src/utils/analyticsEvents.ts); a test checks that every name there is listed here.
CREATE OR REPLACE FUNCTION public._analytics_events()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['app_open', 'search', 'restaurant_view', 'menu_view', 'save', 'sign_up', 'coupon_view', 'share', 'agreement_record_failed'];
$$;

-- ── The app's call ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_app_event(
  p_install_id TEXT,
  p_event TEXT,
  p_props JSONB DEFAULT '{}'::jsonb,
  p_platform TEXT DEFAULT NULL,
  p_app_version TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_props JSONB := COALESCE(p_props, '{}'::jsonb);
BEGIN
  -- a call that is not valid is ignored: usage numbers must never get in the way of the app
  IF p_install_id IS NULL OR p_install_id !~ '^[A-Za-z0-9_-]{8,64}$' THEN RETURN; END IF;
  IF p_event IS NULL OR NOT (p_event = ANY (public._analytics_events())) THEN RETURN; END IF;

  -- small, flat details only
  IF jsonb_typeof(v_props) <> 'object' OR octet_length(v_props::text) > 500 THEN
    v_props := '{}'::jsonb;
  END IF;

  -- one install cannot flood the table
  IF (SELECT COUNT(*) FROM public.app_events e WHERE e.install_id = p_install_id AND e.created_at > now() - interval '1 hour') >= 300 THEN
    RETURN;
  END IF;

  INSERT INTO public.app_events (install_id, event, props, platform, app_version)
  VALUES (
    p_install_id,
    p_event,
    v_props,
    CASE WHEN p_platform IN ('ios', 'android', 'web') THEN p_platform ELSE NULL END,
    CASE WHEN p_app_version IS NOT NULL AND length(p_app_version) <= 20 THEN p_app_version ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_app_event(TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_app_event(TEXT, TEXT, JSONB, TEXT, TEXT) TO anon, authenticated, service_role;

-- ── The admin's numbers ───────────────────────────────────────────────────
-- p_days: how far back to look (1 to 365). One JSON answer:
--   days, since
--   installs           distinct installs seen in the period
--   new_installs       installs whose very first event is in the period
--   events             [{ event, events, installs }]  for every known event, 0 when none
--   daily              [{ day, installs }]  distinct installs per day, oldest first, one row for every day (0 when none)
--   retention          { cohort, returned }  of the installs first seen between p_days ago and 7 days ago, how many have an event 7 or more days after
--                      their first one
CREATE OR REPLACE FUNCTION public.admin_analytics_summary(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days  INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_since TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  PERFORM public._require_admin();
  v_since := date_trunc('day', now()) - ((v_days - 1) * interval '1 day');

  WITH ev AS (
    SELECT install_id, event, created_at FROM public.app_events WHERE created_at >= v_since
  ),
  per_event AS (
    SELECT n.event,
           COUNT(ev.install_id) AS events,
           COUNT(DISTINCT ev.install_id) AS installs
    FROM unnest(public._analytics_events()) AS n(event)
    LEFT JOIN ev ON ev.event = n.event
    GROUP BY n.event
  ),
  days AS (
    SELECT d::date AS day FROM generate_series(v_since::date, now()::date, interval '1 day') AS d
  ),
  daily AS (
    SELECT days.day, COUNT(DISTINCT ev.install_id) AS installs
    FROM days LEFT JOIN ev ON ev.created_at::date = days.day
    GROUP BY days.day
  ),
  firsts AS (
    SELECT install_id, MIN(created_at) AS first_seen FROM public.app_events GROUP BY install_id
  ),
  cohort AS (
    SELECT f.install_id, f.first_seen
    FROM firsts f
    WHERE f.first_seen >= v_since AND f.first_seen <= now() - interval '7 days'
  )
  SELECT jsonb_build_object(
    'days', v_days,
    'since', v_since,
    'installs', (SELECT COUNT(DISTINCT install_id) FROM ev),
    'new_installs', (SELECT COUNT(*) FROM firsts WHERE first_seen >= v_since),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('event', event, 'events', events, 'installs', installs) ORDER BY array_position(public._analytics_events(), event)) FROM per_event), '[]'::jsonb),
    'daily', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'installs', installs) ORDER BY day) FROM daily), '[]'::jsonb),
    'retention', jsonb_build_object(
      'cohort', (SELECT COUNT(*) FROM cohort),
      'returned', (SELECT COUNT(*) FROM cohort c WHERE EXISTS (
        SELECT 1 FROM public.app_events e WHERE e.install_id = c.install_id AND e.created_at >= c.first_seen + interval '7 days'))
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_analytics_summary(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_analytics_summary(INTEGER) TO authenticated, service_role;

-- ── Keeping it small ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_old_app_events(p_days INTEGER DEFAULT 180)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INTEGER;
BEGIN
  DELETE FROM public.app_events WHERE created_at < now() - (GREATEST(COALESCE(p_days, 180), 30) * interval '1 day');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_app_events(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_app_events(INTEGER) TO service_role;

-- every night at 03:17, when pg_cron is installed (without it everything else here still applies; run the function by hand now and then)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not installed: the nightly cleanup of old events was not scheduled.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-app-events') THEN
    PERFORM cron.unschedule('purge-app-events');
  END IF;
  PERFORM cron.schedule('purge-app-events', '17 3 * * *', 'SELECT public.purge_old_app_events(180)');
END $$;

-- City imports: an admin adds a city, and a standalone Python program (crawler/crawl_cities.py, run by cron on the VPS) finds
-- up to N independent restaurants in it through the city-crawl edge function (Google Places text search) and queues each
-- one's website for the existing browser crawler (crawler/crawl_places.py), which reads the menu exactly as it does for an
-- owner's or admin's link. No owner is needed: a menu is tied to the restaurant's Google place ID.
--
--   crawl_cities              one row per city: how many restaurants to find (max_restaurants), whether it is switched on,
--                             its status (pending -> discovering -> crawling -> done, or error / needs_attention), where the
--                             search stopped (so a big city is spread over several calls and can be resumed), and how many
--                             Google requests it has used (google_calls in total, google_calls_last_run for the latest run).
--   city_places               every restaurant the search returned for a city and what became of it: queued (its website was
--                             queued for the crawler), has_menu (it already has a verified menu), no_website, franchise,
--                             not_open. Only queued and has_menu count toward max_restaurants.
--   place_menu_crawl          link_source now also allows 'city'. A city row NEVER replaces an owner's, an admin's or a
--                             found link, and an owner or admin saving a link for the place replaces the city row (migration
--                             122's rules are unchanged).
--   claim_place_crawls        as migration 114, except rows from a city are handed out LAST, so a city's backlog never makes
--                             an owner's or admin's link wait.
--   claim_crawl_city / record_city_discovery / fail_crawl_city / sync_crawl_city_statuses / crawl_city_call_limit
--                             used by the city-crawl edge function (service role only).
--   admin_list_crawl_cities / admin_save_crawl_city / admin_run_crawl_city_again / admin_delete_crawl_city
--                             the admin page (Tools -> City Imports). Admin only.
--
-- Settings (app_config, the admin Config page): cityCrawlMaxCalls = most Google requests one city may use in a single run.
-- Safe to re-run.

-- ── 1. Setting ──────────────────────────────────────────────────────────────
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('cityCrawlMaxCalls', '60', 'Most Google Places requests one city import may use in a single run (1-1000). When a city reaches it the run stops and says so on the City Imports page; Run again continues where it stopped. Takes effect on the next request.', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

CREATE OR REPLACE FUNCTION public.crawl_city_call_limit()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._menu_setting('cityCrawlMaxCalls', 60, 1, 1000);
$$;

REVOKE ALL ON FUNCTION public.crawl_city_call_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crawl_city_call_limit() TO service_role;

-- ── 2. The crawl table accepts a city's link ────────────────────────────────
ALTER TABLE public.place_menu_crawl DROP CONSTRAINT IF EXISTS place_menu_crawl_link_source_check;
ALTER TABLE public.place_menu_crawl
  ADD CONSTRAINT place_menu_crawl_link_source_check CHECK (link_source IN ('owner', 'admin', 'google', 'city'));

-- ── 3. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crawl_cities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  region                TEXT NOT NULL DEFAULT '' CHECK (char_length(region) <= 80),
  max_restaurants       INTEGER NOT NULL DEFAULT 100 CHECK (max_restaurants BETWEEN 1 AND 1000),
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'discovering', 'crawling', 'done', 'error', 'needs_attention')),
  query_index           INTEGER NOT NULL DEFAULT 0,
  page_token            TEXT,
  google_calls          INTEGER NOT NULL DEFAULT 0,
  google_calls_last_run INTEGER NOT NULL DEFAULT 0,
  stop_reason           TEXT CHECK (stop_reason IS NULL OR stop_reason IN ('reached_target', 'ran_out_of_results', 'call_limit')),
  attempts              INTEGER NOT NULL DEFAULT 0,
  last_detail           TEXT,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at            TIMESTAMPTZ,
  discovery_finished_at TIMESTAMPTZ,
  finished_at           TIMESTAMPTZ,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crawl_cities_name ON public.crawl_cities (lower(btrim(name)), lower(btrim(region)));
CREATE INDEX IF NOT EXISTS idx_crawl_cities_due ON public.crawl_cities (status, next_attempt_at);
ALTER TABLE public.crawl_cities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crawl_cities FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.crawl_cities TO service_role;

CREATE TABLE IF NOT EXISTS public.city_places (
  city_id  UUID NOT NULL REFERENCES public.crawl_cities (id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  name     TEXT NOT NULL,
  address  TEXT,
  website  TEXT,
  outcome  TEXT NOT NULL CHECK (outcome IN ('queued', 'has_menu', 'no_website', 'franchise', 'not_open')),
  found_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (city_id, place_id)
);
CREATE INDEX IF NOT EXISTS idx_city_places_place ON public.city_places (place_id);
ALTER TABLE public.city_places ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.city_places FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.city_places TO service_role;

-- ── 4. A city's backlog never delays an owner's or admin's link ─────────────
CREATE OR REPLACE FUNCTION public.claim_place_crawls(p_limit INTEGER DEFAULT 3, p_taken INTEGER DEFAULT 0)
RETURNS TABLE (job_place_id TEXT, job_name TEXT, job_link TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room INTEGER := GREATEST(public._menu_setting('menuCrawlMaxPerRun', 50, 1, 1000) - GREATEST(COALESCE(p_taken, 0), 0), 0);
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT c.place_id
    FROM public.place_menu_crawl c
    WHERE (c.status IN ('pending', 'error') AND c.next_attempt_at <= NOW())
       OR (c.status = 'crawling' AND c.claimed_at < NOW() - INTERVAL '30 minutes')
    ORDER BY (c.link_source = 'city'), c.requested_at   -- city imports last
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 20, v_room)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.place_menu_crawl c
     SET status = 'crawling', claimed_at = NOW(), attempts = c.attempts + 1, updated_at = NOW()
    FROM picked
   WHERE c.place_id = picked.place_id
  RETURNING c.place_id, c.restaurant_name, c.link;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_place_crawls(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_place_crawls(INTEGER, INTEGER) TO service_role;

-- ── 5. The worker's side ────────────────────────────────────────────────────
-- The next city to search: pending, an error whose retry time has come, or one that has been "discovering" for over 30
-- minutes (the program died; it is given out again and continues where it stopped). Switched-off cities are skipped.
CREATE OR REPLACE FUNCTION public.claim_crawl_city()
RETURNS TABLE (job_id UUID, job_name TEXT, job_region TEXT, job_max INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT c.id
    FROM public.crawl_cities c
    WHERE c.enabled
      AND ((c.status IN ('pending', 'error') AND c.next_attempt_at <= NOW())
        OR (c.status = 'discovering' AND c.claimed_at < NOW() - INTERVAL '30 minutes'))
    ORDER BY c.requested_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.crawl_cities c
     SET google_calls_last_run = CASE WHEN c.status = 'discovering' THEN c.google_calls_last_run ELSE 0 END,
         status = 'discovering', claimed_at = NOW(), attempts = c.attempts + 1, updated_at = NOW()
    FROM picked
   WHERE c.id = picked.id
  RETURNING c.id, c.name, c.region, c.max_restaurants;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_crawl_city() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crawl_city() TO service_role;

-- Records one batch of search results for a city.
--   p_places       the places the search returned: [{place_id, name, address, website, is_open}]
--   p_calls        how many Google requests this batch used
--   p_next_*       where the search continues (query number, next-page token)
--   p_this_*       where THIS batch was read, so a stop in the middle of a page re-reads that page next time
--   p_stop         NULL to continue, or 'ran_out_of_results' / 'call_limit'; reaching max_restaurants stops it too
-- Returns {counted, added, finished, stop_reason}. A place already listed for the city is skipped; one that is not open, a
-- franchise, already has a verified menu, or has no website is recorded but not queued; the rest are queued for the
-- crawler (and an existing queue row, from an owner, an admin or an earlier city, is left as it is).
CREATE OR REPLACE FUNCTION public.record_city_discovery(
  p_city_id UUID, p_places JSONB, p_calls INTEGER,
  p_next_query INTEGER, p_next_token TEXT, p_this_query INTEGER, p_this_token TEXT, p_stop TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_city     public.crawl_cities%ROWTYPE;
  v_counted  INTEGER;
  v_added    INTEGER := 0;
  v_p        RECORD;
  v_name     TEXT;
  v_site     TEXT;
  v_outcome  TEXT;
  v_stop     TEXT := NULLIF(p_stop, '');
  v_midpage  BOOLEAN := FALSE;
  v_status   TEXT;
BEGIN
  SELECT * INTO v_city FROM public.crawl_cities c WHERE c.id = p_city_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('finished', TRUE, 'stop_reason', 'unknown'); END IF;
  IF v_stop IS NOT NULL AND v_stop NOT IN ('ran_out_of_results', 'call_limit') THEN v_stop := NULL; END IF;

  SELECT COUNT(*) INTO v_counted FROM public.city_places x WHERE x.city_id = p_city_id AND x.outcome IN ('queued', 'has_menu');

  FOR v_p IN
    SELECT * FROM jsonb_to_recordset(CASE WHEN jsonb_typeof(p_places) = 'array' THEN p_places ELSE '[]'::jsonb END)
      AS x(place_id TEXT, name TEXT, address TEXT, website TEXT, is_open BOOLEAN)
  LOOP
    v_name := btrim(COALESCE(v_p.name, ''));
    v_site := btrim(COALESCE(v_p.website, ''));
    CONTINUE WHEN v_p.place_id IS NULL OR v_p.place_id !~ '^[A-Za-z0-9_-]{10,200}$' OR v_name = '';
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.city_places x WHERE x.city_id = p_city_id AND x.place_id = v_p.place_id);
    IF v_counted >= v_city.max_restaurants THEN v_midpage := TRUE; EXIT; END IF;

    IF v_p.is_open IS FALSE THEN
      v_outcome := 'not_open';
    ELSIF public.is_franchise_chain(v_name) THEN
      v_outcome := 'franchise';
    ELSIF EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.place_id = v_p.place_id AND mi.is_verified) THEN
      v_outcome := 'has_menu';
    ELSIF v_site = '' OR length(v_site) > 2000 OR v_site !~* '^https?://[^[:space:]]{4,}$' THEN
      v_outcome := 'no_website';
    ELSE
      INSERT INTO public.place_menu_crawl (place_id, restaurant_name, link, link_source)
      VALUES (v_p.place_id, v_name, v_site, 'city')
      ON CONFLICT (place_id) DO NOTHING;
      v_outcome := 'queued';
    END IF;

    INSERT INTO public.city_places (city_id, place_id, name, address, website, outcome)
    VALUES (p_city_id, v_p.place_id, LEFT(v_name, 200), LEFT(v_p.address, 300), LEFT(NULLIF(v_site, ''), 2000), v_outcome)
    ON CONFLICT (city_id, place_id) DO NOTHING;
    IF v_outcome IN ('queued', 'has_menu') THEN v_counted := v_counted + 1; END IF;
    v_added := v_added + 1;
  END LOOP;

  -- the target was reached: stop (the search position is where this batch was read when it stopped in the middle)
  IF v_counted >= v_city.max_restaurants THEN v_stop := 'reached_target'; END IF;

  IF v_stop IS NULL THEN
    UPDATE public.crawl_cities c
       SET google_calls = c.google_calls + GREATEST(COALESCE(p_calls, 0), 0),
           google_calls_last_run = c.google_calls_last_run + GREATEST(COALESCE(p_calls, 0), 0),
           query_index = GREATEST(COALESCE(p_next_query, 0), 0), page_token = p_next_token,
           claimed_at = NOW(), updated_at = NOW()
     WHERE c.id = p_city_id;
    RETURN jsonb_build_object('counted', v_counted, 'added', v_added, 'finished', FALSE, 'stop_reason', NULL);
  END IF;

  -- finished searching: crawling while any queued restaurant is still waiting to be read, else done
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM public.city_places x JOIN public.place_menu_crawl m ON m.place_id = x.place_id
            WHERE x.city_id = p_city_id AND x.outcome = 'queued' AND m.status IN ('pending', 'crawling', 'error')
         ) THEN 'crawling' ELSE 'done' END INTO v_status;
  UPDATE public.crawl_cities c
     SET google_calls = c.google_calls + GREATEST(COALESCE(p_calls, 0), 0),
         google_calls_last_run = c.google_calls_last_run + GREATEST(COALESCE(p_calls, 0), 0),
         query_index = CASE WHEN v_stop = 'reached_target' THEN GREATEST(COALESCE(p_this_query, 0), 0) ELSE GREATEST(COALESCE(p_next_query, 0), 0) END,
         page_token  = CASE WHEN v_stop = 'reached_target' THEN p_this_token ELSE p_next_token END,
         stop_reason = v_stop, status = v_status, attempts = 0, last_detail = NULL,
         discovery_finished_at = NOW(), finished_at = CASE WHEN v_status = 'done' THEN NOW() ELSE NULL END,
         claimed_at = NOW(), updated_at = NOW()
   WHERE c.id = p_city_id;
  RETURN jsonb_build_object('counted', v_counted, 'added', v_added, 'finished', TRUE, 'stop_reason', v_stop, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.record_city_discovery(UUID, JSONB, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_city_discovery(UUID, JSONB, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TEXT) TO service_role;

-- A search that failed: retried after 6 hours, flagged needs_attention after menuBuildMaxAttempts failures. The search
-- position and the request count are kept, so a retry continues where it stopped.
CREATE OR REPLACE FUNCTION public.fail_crawl_city(p_city_id UUID, p_detail TEXT, p_calls INTEGER DEFAULT 0)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_city public.crawl_cities%ROWTYPE;
  v_max  INTEGER := public._menu_setting('menuBuildMaxAttempts', 3, 1, 10);
  v_new  TEXT;
BEGIN
  SELECT * INTO v_city FROM public.crawl_cities c WHERE c.id = p_city_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  v_new := CASE WHEN v_city.attempts >= v_max THEN 'needs_attention' ELSE 'error' END;
  UPDATE public.crawl_cities c
     SET status = v_new, last_detail = LEFT(p_detail, 300),
         google_calls = c.google_calls + GREATEST(COALESCE(p_calls, 0), 0),
         google_calls_last_run = c.google_calls_last_run + GREATEST(COALESCE(p_calls, 0), 0),
         next_attempt_at = CASE WHEN v_new = 'error' THEN NOW() + INTERVAL '6 hours' ELSE 'infinity' END,
         updated_at = NOW()
   WHERE c.id = p_city_id;
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_crawl_city(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_crawl_city(UUID, TEXT, INTEGER) TO service_role;

-- Moves cities whose restaurants have all been read from "crawling" to "done". Returns how many changed.
CREATE OR REPLACE FUNCTION public.sync_crawl_city_statuses()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed INTEGER;
BEGIN
  UPDATE public.crawl_cities c
     SET status = 'done', finished_at = NOW(), updated_at = NOW()
   WHERE c.status = 'crawling'
     AND NOT EXISTS (
       SELECT 1 FROM public.city_places x JOIN public.place_menu_crawl m ON m.place_id = x.place_id
        WHERE x.city_id = c.id AND x.outcome = 'queued' AND m.status IN ('pending', 'crawling', 'error')
     );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_crawl_city_statuses() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_crawl_city_statuses() TO service_role;

-- ── 6. The admin page ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_crawl_cities();

CREATE FUNCTION public.admin_list_crawl_cities()
RETURNS TABLE (
  id UUID, name TEXT, region TEXT, max_restaurants INTEGER, enabled BOOLEAN, status TEXT, stop_reason TEXT,
  google_calls INTEGER, google_calls_last_run INTEGER, last_detail TEXT,
  places_found INTEGER, queued INTEGER, has_menu INTEGER, no_website INTEGER, franchises INTEGER, not_open INTEGER,
  reading_waiting INTEGER, reading_done INTEGER, reading_no_items INTEGER, reading_failed INTEGER,
  discovery_finished_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT c.id, c.name, c.region, c.max_restaurants, c.enabled, c.status, c.stop_reason,
         c.google_calls, c.google_calls_last_run, c.last_detail,
         COUNT(p.place_id)::INTEGER,
         (COUNT(*) FILTER (WHERE p.outcome = 'queued'))::INTEGER,
         (COUNT(*) FILTER (WHERE p.outcome = 'has_menu'))::INTEGER,
         (COUNT(*) FILTER (WHERE p.outcome = 'no_website'))::INTEGER,
         (COUNT(*) FILTER (WHERE p.outcome = 'franchise'))::INTEGER,
         (COUNT(*) FILTER (WHERE p.outcome = 'not_open'))::INTEGER,
         (COUNT(*) FILTER (WHERE p.outcome = 'queued' AND m.status IN ('pending', 'crawling')))::INTEGER,
         (COUNT(*) FILTER (WHERE p.outcome = 'queued' AND m.status = 'done'))::INTEGER,
         (COUNT(*) FILTER (WHERE p.outcome = 'queued' AND m.status = 'no_items'))::INTEGER,
         (COUNT(*) FILTER (WHERE p.outcome = 'queued' AND m.status IN ('error', 'needs_attention')))::INTEGER,
         c.discovery_finished_at, c.finished_at, c.created_at
    FROM public.crawl_cities c
    LEFT JOIN public.city_places p ON p.city_id = c.id
    LEFT JOIN public.place_menu_crawl m ON m.place_id = p.place_id
   GROUP BY c.id
   ORDER BY c.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_crawl_cities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_crawl_cities() TO authenticated;

-- Puts a city back in line. The search continues where it stopped if it stopped early (target reached or request limit);
-- otherwise (it ran out of results, or never finished) it starts again from the first search.
CREATE OR REPLACE FUNCTION public._requeue_crawl_city(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.crawl_cities c
     SET status = 'pending', attempts = 0, last_detail = NULL, next_attempt_at = NOW(), requested_at = NOW(),
         finished_at = NULL, google_calls_last_run = 0,
         query_index = CASE WHEN c.stop_reason IN ('reached_target', 'call_limit') THEN c.query_index ELSE 0 END,
         page_token  = CASE WHEN c.stop_reason IN ('reached_target', 'call_limit') THEN c.page_token ELSE NULL END,
         stop_reason = NULL, updated_at = NOW()
   WHERE c.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public._requeue_crawl_city(UUID) FROM PUBLIC, anon, authenticated;

-- Adds a city (p_id NULL) or edits one. Raising the number of restaurants on a city that stopped because it reached its
-- target (or its request limit) puts it back in line to find more.
CREATE OR REPLACE FUNCTION public.admin_save_crawl_city(
  p_id UUID, p_name TEXT, p_region TEXT, p_max INTEGER, p_enabled BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name   TEXT := btrim(COALESCE(p_name, ''));
  v_region TEXT := btrim(COALESCE(p_region, ''));
  v_id     UUID := p_id;
  v_old    public.crawl_cities%ROWTYPE;
BEGIN
  PERFORM public._require_admin();
  IF char_length(v_name) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'The city name must be 2 to 80 characters'; END IF;
  IF char_length(v_region) > 80 THEN RAISE EXCEPTION 'The state or country must be 80 characters or fewer'; END IF;
  IF p_max IS NULL OR p_max NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'The number of restaurants must be between 1 and 1000'; END IF;

  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.crawl_cities (name, region, max_restaurants, enabled, created_by)
      VALUES (v_name, v_region, p_max, COALESCE(p_enabled, TRUE), auth.uid())
      RETURNING id INTO v_id;
    ELSE
      SELECT * INTO v_old FROM public.crawl_cities c WHERE c.id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'City not found'; END IF;
      UPDATE public.crawl_cities c
         SET name = v_name, region = v_region, max_restaurants = p_max, enabled = COALESCE(p_enabled, TRUE), updated_at = NOW()
       WHERE c.id = v_id;
      IF p_max > v_old.max_restaurants AND v_old.stop_reason IN ('reached_target', 'call_limit')
         AND v_old.status IN ('crawling', 'done') THEN
        PERFORM public._requeue_crawl_city(v_id);
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That city is already in the list';
  END;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_crawl_city(UUID, TEXT, TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_crawl_city(UUID, TEXT, TEXT, INTEGER, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_run_crawl_city_again(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  IF NOT EXISTS (SELECT 1 FROM public.crawl_cities c WHERE c.id = p_id) THEN RAISE EXCEPTION 'City not found'; END IF;
  PERFORM public._requeue_crawl_city(p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_crawl_city_again(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_crawl_city_again(UUID) TO authenticated;

-- Removes the city and its list of found restaurants. Menus already imported, and restaurants already queued for the
-- crawler, are left alone.
CREATE OR REPLACE FUNCTION public.admin_delete_crawl_city(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  DELETE FROM public.crawl_cities c WHERE c.id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'City not found'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_crawl_city(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_crawl_city(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

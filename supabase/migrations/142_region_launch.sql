-- Region launch control: the app is open to customers state by state. A customer can use it only when the US state they are physically in is LIVE.
--
--   launch_regions               one row per US state (and DC): off / scheduled / live, a go-live time, and an admin note. A SCHEDULED region
--                                becomes live by itself once its time has passed (worked out when asked, so no job is needed). Kansas starts LIVE,
--                                every other state OFF.
--   app_config enforceRegionGating
--                                the master switch, 'false' by default. While it is 'false' nobody is blocked and no location is looked up.
--   region_cells                 a cache of "this ~1 km map square is in this state", so a place is looked up once (Google reverse geocoding) and
--                                then answered from here. Written by the service role only.
--   region_waitlist              emails of people in a state that is not live yet ("tell me when you open"). One row per email and state.
--   region_gate_enforced()       reads the switch.
--   region_status(country, state)
--                                { allowed, status, stateCode, name, goLiveAt }. Outside the US is not allowed.
--   place_region_allowed(place_id)
--                                TRUE when the switch is off, the place's own state (read from its address) is live, or its state is unknown. Used to
--                                keep expensive menu builds from running for a state that is not open.
--   region_cell_lookup / record_region_cell
--                                the cache (service role).
--   join_region_waitlist / leave_region_waitlist
--                                a signed-in customer joins or leaves the waitlist for the state they are in.
--   admin_list_regions / admin_set_region / admin_turn_off_all_regions / admin_region_waitlist
--                                the Region Management page. Admin only.
--
-- Safe to re-run. An admin's changes to launch_regions are kept when this is re-run.

-- ── 1. The regions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.launch_regions (
  state_code  TEXT PRIMARY KEY CHECK (state_code ~ '^[A-Z]{2}$'),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'off' CHECK (status IN ('off', 'scheduled', 'live')),
  go_live_at  TIMESTAMPTZ,
  note        TEXT CHECK (note IS NULL OR char_length(note) <= 300),
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT launch_regions_scheduled_needs_time CHECK (status <> 'scheduled' OR go_live_at IS NOT NULL)
);

ALTER TABLE public.launch_regions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.launch_regions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.launch_regions TO service_role;

INSERT INTO public.launch_regions (state_code, name, status) VALUES
  ('AL','Alabama','off'),('AK','Alaska','off'),('AZ','Arizona','off'),('AR','Arkansas','off'),('CA','California','off'),('CO','Colorado','off'),
  ('CT','Connecticut','off'),('DE','Delaware','off'),('DC','District of Columbia','off'),('FL','Florida','off'),('GA','Georgia','off'),
  ('HI','Hawaii','off'),('ID','Idaho','off'),('IL','Illinois','off'),('IN','Indiana','off'),('IA','Iowa','off'),('KS','Kansas','live'),
  ('KY','Kentucky','off'),('LA','Louisiana','off'),('ME','Maine','off'),('MD','Maryland','off'),('MA','Massachusetts','off'),
  ('MI','Michigan','off'),('MN','Minnesota','off'),('MS','Mississippi','off'),('MO','Missouri','off'),('MT','Montana','off'),
  ('NE','Nebraska','off'),('NV','Nevada','off'),('NH','New Hampshire','off'),('NJ','New Jersey','off'),('NM','New Mexico','off'),
  ('NY','New York','off'),('NC','North Carolina','off'),('ND','North Dakota','off'),('OH','Ohio','off'),('OK','Oklahoma','off'),
  ('OR','Oregon','off'),('PA','Pennsylvania','off'),('RI','Rhode Island','off'),('SC','South Carolina','off'),('SD','South Dakota','off'),
  ('TN','Tennessee','off'),('TX','Texas','off'),('UT','Utah','off'),('VT','Vermont','off'),('VA','Virginia','off'),('WA','Washington','off'),
  ('WV','West Virginia','off'),('WI','Wisconsin','off'),('WY','Wyoming','off')
ON CONFLICT (state_code) DO NOTHING;

-- ── 2. The master switch ───────────────────────────────────────────────────
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('enforceRegionGating', 'false', 'Server: when ON, customers are let in only in states that are LIVE on the Region Management page (Tools). OFF (default) = nobody is blocked and no location is looked up.', 'No .env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

CREATE OR REPLACE FUNCTION public.region_gate_enforced()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT lower(btrim(c.value)) = 'true' FROM public.app_config c WHERE c.key = 'enforceRegionGating'), FALSE);
$$;

-- ── 3. Is a state open? ────────────────────────────────────────────────────
-- A region is open when it is 'live', or 'scheduled' and its time has passed.
CREATE OR REPLACE FUNCTION public._region_is_open(p_status TEXT, p_go_live_at TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT p_status = 'live' OR (p_status = 'scheduled' AND p_go_live_at IS NOT NULL AND p_go_live_at <= NOW());
$$;

-- What a customer in this country and state may do. Outside the US, or a state we do not know, is not open.
CREATE OR REPLACE FUNCTION public.region_status(p_country TEXT, p_state TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.launch_regions%ROWTYPE;
  v_country TEXT := upper(btrim(COALESCE(p_country, '')));
  v_state   TEXT := upper(btrim(COALESCE(p_state, '')));
BEGIN
  IF v_country <> 'US' THEN
    RETURN jsonb_build_object('allowed', FALSE, 'status', 'not_us', 'stateCode', NULLIF(v_state, ''), 'name', NULL, 'goLiveAt', NULL);
  END IF;
  SELECT * INTO v_row FROM public.launch_regions r WHERE r.state_code = v_state;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', FALSE, 'status', 'unknown', 'stateCode', NULLIF(v_state, ''), 'name', NULL, 'goLiveAt', NULL);
  END IF;
  RETURN jsonb_build_object(
    'allowed',   public._region_is_open(v_row.status, v_row.go_live_at),
    'status',    CASE WHEN public._region_is_open(v_row.status, v_row.go_live_at) THEN 'live'
                      WHEN v_row.status = 'scheduled' THEN 'scheduled' ELSE 'off' END,
    'stateCode', v_row.state_code,
    'name',      v_row.name,
    'goLiveAt',  CASE WHEN v_row.status = 'scheduled' AND v_row.go_live_at > NOW() THEN v_row.go_live_at END
  );
END;
$$;

-- An expensive thing keyed to a place (a menu build) should not run for a state that is not open. The place's state is read from its address.
-- A switch that is off, or a place with no readable state, means yes.
CREATE OR REPLACE FUNCTION public.place_region_allowed(p_place_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state TEXT;
  v_row   public.launch_regions%ROWTYPE;
BEGIN
  IF NOT public.region_gate_enforced() THEN
    RETURN TRUE;
  END IF;
  SELECT public.normalize_state(public.address_state(cr.address)) INTO v_state
  FROM public.cached_restaurants cr WHERE cr.place_id = p_place_id;
  IF v_state IS NULL THEN
    RETURN TRUE;
  END IF;
  SELECT * INTO v_row FROM public.launch_regions r WHERE r.state_code = v_state;
  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;
  RETURN public._region_is_open(v_row.status, v_row.go_live_at);
END;
$$;

-- ── 4. The location cache ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.region_cells (
  cell_key     TEXT PRIMARY KEY,
  state_code   TEXT,
  country_code TEXT,
  cached_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.region_cells ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.region_cells FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.region_cells TO service_role;

-- A cached answer younger than 30 days (Google's limit for keeping location lookups).
CREATE OR REPLACE FUNCTION public.region_cell_lookup(p_cell TEXT)
RETURNS TABLE (state_code TEXT, country_code TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.state_code, c.country_code
  FROM public.region_cells c
  WHERE c.cell_key = p_cell AND c.cached_at > NOW() - INTERVAL '30 days';
$$;

CREATE OR REPLACE FUNCTION public.record_region_cell(p_cell TEXT, p_state TEXT, p_country TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.region_cells (cell_key, state_code, country_code, cached_at)
  VALUES (p_cell, NULLIF(upper(btrim(p_state)), ''), NULLIF(upper(btrim(p_country)), ''), NOW())
  ON CONFLICT (cell_key) DO UPDATE
    SET state_code = EXCLUDED.state_code, country_code = EXCLUDED.country_code, cached_at = NOW();
$$;

-- ── 5. The waitlist ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.region_waitlist (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL CHECK (char_length(email) BETWEEN 5 AND 254),
  country_code TEXT NOT NULL DEFAULT 'US',
  state_code   TEXT NOT NULL DEFAULT '',
  user_id      UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email, country_code, state_code)
);
CREATE INDEX IF NOT EXISTS idx_region_waitlist_state ON public.region_waitlist (country_code, state_code);

ALTER TABLE public.region_waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.region_waitlist FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.region_waitlist TO service_role;

-- A signed-in customer asks to be told when their state opens. Returns TRUE when they are on the list (also if they already were).
CREATE OR REPLACE FUNCTION public.join_region_waitlist(p_email TEXT, p_country TEXT, p_state TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email   TEXT := lower(btrim(COALESCE(p_email, '')));
  v_country TEXT := upper(btrim(COALESCE(p_country, 'US')));
  v_state   TEXT := upper(btrim(COALESCE(p_state, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' OR char_length(v_email) > 254 THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;
  IF v_country !~ '^[A-Z]{2}$' OR v_state !~ '^[A-Z0-9]{0,3}$' THEN
    RAISE EXCEPTION 'Unknown place';
  END IF;
  -- a limit so one person cannot fill the list: at most 5 places per account
  IF (SELECT COUNT(*) FROM public.region_waitlist w WHERE w.user_id = auth.uid()) >= 5
     AND NOT EXISTS (SELECT 1 FROM public.region_waitlist w WHERE w.user_id = auth.uid() AND w.email = v_email AND w.country_code = v_country AND w.state_code = v_state) THEN
    RAISE EXCEPTION 'You are already on the list for several places';
  END IF;
  INSERT INTO public.region_waitlist (email, country_code, state_code, user_id)
  VALUES (v_email, v_country, v_state, auth.uid())
  ON CONFLICT (email, country_code, state_code) DO NOTHING;
  RETURN TRUE;
END;
$$;

-- Takes the signed-in customer off the waitlist for this place (all their emails for it).
CREATE OR REPLACE FUNCTION public.leave_region_waitlist(p_country TEXT, p_state TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.region_waitlist w
  WHERE w.user_id = auth.uid()
    AND w.country_code = upper(btrim(COALESCE(p_country, 'US')))
    AND w.state_code = upper(btrim(COALESCE(p_state, '')));
$$;

-- ── 6. Admin ───────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_regions();
CREATE FUNCTION public.admin_list_regions()
RETURNS TABLE (
  state_code       TEXT,
  name             TEXT,
  status           TEXT,
  go_live_at       TIMESTAMPTZ,
  note             TEXT,
  is_open          BOOLEAN,
  waitlist_count   BIGINT,
  restaurant_count BIGINT,
  with_menu_count  BIGINT,
  updated_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  WITH rest AS (
    SELECT public.normalize_state(public.address_state(cr.address)) AS st,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.place_id = cr.place_id)) AS with_menu
    FROM public.cached_restaurants cr
    GROUP BY 1
  ), wl AS (
    SELECT w.state_code AS st, COUNT(*) AS n FROM public.region_waitlist w WHERE w.country_code = 'US' GROUP BY 1
  )
  SELECT r.state_code, r.name, r.status, r.go_live_at, r.note,
         public._region_is_open(r.status, r.go_live_at),
         COALESCE(wl.n, 0), COALESCE(rest.total, 0), COALESCE(rest.with_menu, 0), r.updated_at
  FROM public.launch_regions r
  LEFT JOIN rest ON rest.st = r.state_code
  LEFT JOIN wl   ON wl.st = r.state_code
  ORDER BY r.name;
END;
$$;

-- status 'live' / 'off' ignore the time; 'scheduled' needs the time it opens.
CREATE OR REPLACE FUNCTION public.admin_set_region(
  p_state_code TEXT,
  p_status     TEXT,
  p_go_live_at TIMESTAMPTZ DEFAULT NULL,
  p_note       TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  IF p_status NOT IN ('off', 'scheduled', 'live') THEN
    RAISE EXCEPTION 'Status must be off, scheduled or live';
  END IF;
  IF p_status = 'scheduled' AND p_go_live_at IS NULL THEN
    RAISE EXCEPTION 'Choose when the state opens';
  END IF;
  UPDATE public.launch_regions r
     SET status = p_status,
         go_live_at = CASE WHEN p_status = 'scheduled' THEN p_go_live_at ELSE NULL END,
         note = NULLIF(btrim(COALESCE(p_note, '')), ''),
         updated_by = auth.uid(),
         updated_at = NOW()
   WHERE r.state_code = upper(btrim(p_state_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown state %', p_state_code;
  END IF;
END;
$$;

-- The emergency button: every state off. Returns how many changed.
CREATE OR REPLACE FUNCTION public.admin_turn_off_all_regions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  PERFORM public._require_admin();
  UPDATE public.launch_regions r
     SET status = 'off', go_live_at = NULL, updated_by = auth.uid(), updated_at = NOW()
   WHERE r.status <> 'off';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- The emails waiting for one state (newest first).
CREATE OR REPLACE FUNCTION public.admin_region_waitlist(p_state_code TEXT, p_limit INTEGER DEFAULT 500)
RETURNS TABLE (email TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT w.email, w.created_at
  FROM public.region_waitlist w
  WHERE w.country_code = 'US' AND w.state_code = upper(btrim(p_state_code))
  ORDER BY w.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000);
END;
$$;

-- ── 7. Who may call what ───────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.region_gate_enforced() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.region_status(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.place_region_allowed(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.region_cell_lookup(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_region_cell(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.join_region_waitlist(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_region_waitlist(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_regions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_region(TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_turn_off_all_regions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_region_waitlist(TEXT, INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.region_gate_enforced() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.region_status(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.place_region_allowed(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.region_cell_lookup(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_region_cell(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_region_waitlist(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_region_waitlist(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_regions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_region(TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_turn_off_all_regions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_region_waitlist(TEXT, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

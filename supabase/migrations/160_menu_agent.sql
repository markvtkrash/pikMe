-- Menu agent: an AI agent that reads a restaurant's website step by step and PROPOSES menu items for an admin to approve.
--
--   menu_agent_jobs        one row per restaurant to read: status, attempts, steps taken, tokens used.
--   menu_agent_steps       one row per step the agent took (action, page, tokens): the audit trail and the cost record.
--   menu_agent_proposals   dishes the agent found. Nothing reaches menu_items until an admin approves it.
--
-- Settings (app_config, all DB-only; the AI key QUICKSILVER_API_KEY stays an edge-function secret, never on the VPS):
--   menuAgentEnabled        (false)        master switch.
--   menuAgentAiProvider     (quicksilver)  quicksilver or claude; used only by the agent. Blank follows aiProvider.
--   menuAgentModel / menuAgentVisionModel  blank = the provider's own text / vision model setting.
--   menuAgentMaxSteps       (10)           most steps one job may take (1-50).
--   menuAgentDailyTokenCap / menuAgentDailyJobCap   blank = unlimited.
--   menuAgentInputPricePerMTok / menuAgentOutputPricePerMTok   blank = cost not estimated.
--
-- Everything here is service-role only, except the admin functions added below. Safe to re-run.

-- ── 1. Settings ─────────────────────────────────────────────────────────────
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('menuAgentEnabled', 'false', 'Master switch for the menu agent (true or false). While false, no agent job is handed out.', 'Edge function: no env equivalent, DB-only'),
  ('menuAgentAiProvider', 'quicksilver', 'AI provider used only by the menu agent: quicksilver or claude. Defaults to quicksilver, whatever the app-wide aiProvider is. Clear it to follow the app-wide AI provider instead.', 'Edge function: MENU_AGENT_AI_PROVIDER (optional)'),
  ('menuAgentModel', '', 'Text model used only by the menu agent. Blank uses the chosen provider''s own text model setting.', 'Edge function: no env equivalent, DB-only'),
  ('menuAgentVisionModel', '', 'Vision model used only by the menu agent for menu images. Blank uses the chosen provider''s own vision model setting.', 'Edge function: no env equivalent, DB-only'),
  ('menuAgentMaxSteps', '10', 'Most steps (page reads, clicks, image reads) one menu agent job may take (1-50).', 'Edge function: no env equivalent, DB-only'),
  ('menuAgentDailyTokenCap', '', 'Most AI tokens (input + output) the menu agent may use in 24 hours. Blank means unlimited.', 'Edge function: no env equivalent, DB-only'),
  ('menuAgentDailyJobCap', '', 'Most menu agent jobs that may start in 24 hours. Blank means unlimited.', 'Edge function: no env equivalent, DB-only'),
  ('menuAgentInputPricePerMTok', '', 'Price in USD per million input tokens, used only to estimate the agent''s cost on the admin page. Blank means no estimate.', 'Edge function: no env equivalent, DB-only'),
  ('menuAgentOutputPricePerMTok', '', 'Price in USD per million output tokens, used only to estimate the agent''s cost on the admin page. Blank means no estimate.', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

-- ── 2. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_agent_jobs (
  id              BIGSERIAL PRIMARY KEY,
  place_id        TEXT NOT NULL,
  restaurant_name TEXT NOT NULL,
  start_url       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'done', 'no_items', 'error', 'needs_attention')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  steps_taken     INTEGER NOT NULL DEFAULT 0,
  input_tokens    BIGINT NOT NULL DEFAULT 0,
  output_tokens   BIGINT NOT NULL DEFAULT 0,
  last_detail     TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- one open job per restaurant: a second request while one is pending or running is ignored
CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_agent_jobs_open ON public.menu_agent_jobs (place_id) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_menu_agent_jobs_due ON public.menu_agent_jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_menu_agent_jobs_place ON public.menu_agent_jobs (place_id, requested_at DESC);
ALTER TABLE public.menu_agent_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_agent_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.menu_agent_jobs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.menu_agent_jobs_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.menu_agent_steps (
  id            BIGSERIAL PRIMARY KEY,
  job_id        BIGINT NOT NULL REFERENCES public.menu_agent_jobs (id) ON DELETE CASCADE,
  step_no       INTEGER NOT NULL CHECK (step_no >= 1),
  action        TEXT NOT NULL,
  url           TEXT,
  model         TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  detail        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, step_no)
);
ALTER TABLE public.menu_agent_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_agent_steps FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.menu_agent_steps TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.menu_agent_steps_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.menu_agent_proposals (
  id          BIGSERIAL PRIMARY KEY,
  job_id      BIGINT NOT NULL REFERENCES public.menu_agent_jobs (id) ON DELETE CASCADE,
  place_id    TEXT NOT NULL,
  item_name   TEXT NOT NULL CHECK (char_length(btrim(item_name)) BETWEEN 1 AND 200),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
  price       NUMERIC(10, 2) CHECK (price IS NULL OR price >= 0),
  source_url  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by  UUID,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_menu_agent_proposals_job ON public.menu_agent_proposals (job_id);
CREATE INDEX IF NOT EXISTS idx_menu_agent_proposals_place ON public.menu_agent_proposals (place_id, status);
ALTER TABLE public.menu_agent_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_agent_proposals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.menu_agent_proposals TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.menu_agent_proposals_id_seq TO service_role;


-- ── 3. Settings helpers ─────────────────────────────────────────────────────
-- A whole-number setting where blank (or anything that is not a number) means "no limit": returns NULL.
CREATE OR REPLACE FUNCTION public._menu_agent_limit(p_key TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN c.value ~ '^[0-9]{1,12}$' THEN c.value::BIGINT END FROM public.app_config c WHERE c.key = p_key;
$$;

REVOKE ALL ON FUNCTION public._menu_agent_limit(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.menu_agent_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT lower(btrim(c.value)) = 'true' FROM public.app_config c WHERE c.key = 'menuAgentEnabled'), FALSE);
$$;

REVOKE ALL ON FUNCTION public.menu_agent_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.menu_agent_enabled() TO service_role;

-- Tokens and jobs used in the last 24 hours, for the daily caps.
CREATE OR REPLACE FUNCTION public._menu_agent_cap_reached()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_tokens_cap BIGINT := public._menu_agent_limit('menuAgentDailyTokenCap');
  v_jobs_cap   BIGINT := public._menu_agent_limit('menuAgentDailyJobCap');
BEGIN
  IF v_tokens_cap IS NOT NULL AND COALESCE((
       SELECT SUM(s.input_tokens + s.output_tokens) FROM public.menu_agent_steps s WHERE s.created_at > NOW() - INTERVAL '24 hours'
     ), 0) >= v_tokens_cap THEN
    RETURN TRUE;
  END IF;
  IF v_jobs_cap IS NOT NULL AND (
       SELECT COUNT(*) FROM public.menu_agent_jobs j WHERE j.claimed_at > NOW() - INTERVAL '24 hours' AND j.attempts = 1
     ) >= v_jobs_cap THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public._menu_agent_cap_reached() FROM PUBLIC, anon, authenticated;

-- ── 4. Eligibility and request ──────────────────────────────────────────────
-- Result: disabled, bad_input, franchise, has_menu, already_open, queued.
-- Only independents with no verified item are eligible; a franchise has one shared chain menu.
CREATE OR REPLACE FUNCTION public.request_menu_agent_job(p_place_id TEXT, p_name TEXT, p_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := btrim(COALESCE(p_name, ''));
  v_url  TEXT := btrim(COALESCE(p_url, ''));
BEGIN
  IF NOT public.menu_agent_enabled() THEN RETURN 'disabled'; END IF;
  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' OR v_name = ''
     OR length(v_url) > 2000 OR v_url !~* '^https?://[^[:space:]]{4,}$' THEN
    RETURN 'bad_input';
  END IF;
  IF public.is_franchise_chain(v_name) THEN RETURN 'franchise'; END IF;
  IF EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.place_id = p_place_id AND mi.is_verified) THEN RETURN 'has_menu'; END IF;

  INSERT INTO public.menu_agent_jobs (place_id, restaurant_name, start_url)
  VALUES (p_place_id, LEFT(v_name, 200), v_url)
  ON CONFLICT (place_id) WHERE status IN ('pending', 'running') DO NOTHING;
  IF NOT FOUND THEN RETURN 'already_open'; END IF;
  RETURN 'queued';
END;
$$;

REVOKE ALL ON FUNCTION public.request_menu_agent_job(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_menu_agent_job(TEXT, TEXT, TEXT) TO service_role;


-- ── 5. The worker's side ────────────────────────────────────────────────────
-- Hands out the next job (and takes it). Nothing is handed out while the agent is off or a daily cap is reached.
-- A job stuck 'running' for over 30 minutes (the worker died) is given out again.
CREATE OR REPLACE FUNCTION public.claim_menu_agent_job()
RETURNS TABLE (job_id BIGINT, job_place_id TEXT, job_name TEXT, job_url TEXT, job_max_steps INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  IF NOT public.menu_agent_enabled() OR public._menu_agent_cap_reached() THEN RETURN; END IF;

  SELECT j.id INTO v_id
  FROM public.menu_agent_jobs j
  WHERE (j.status IN ('pending', 'error') AND j.next_attempt_at <= NOW())
     OR (j.status = 'running' AND j.claimed_at < NOW() - INTERVAL '30 minutes')
  ORDER BY j.requested_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN; END IF;

  UPDATE public.menu_agent_jobs j
     SET status = 'running', claimed_at = NOW(), attempts = j.attempts + 1, updated_at = NOW()
   WHERE j.id = v_id;

  RETURN QUERY
  SELECT j.id, j.place_id, j.restaurant_name, j.start_url, public._menu_setting('menuAgentMaxSteps', 10, 1, 50)
  FROM public.menu_agent_jobs j WHERE j.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_menu_agent_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_menu_agent_job() TO service_role;

-- Records one step and adds its tokens to the job. Returns 'ok', 'unknown' (no such running job), 'max_steps' (the
-- step limit is reached: the agent must stop and finish) or 'cap_reached' (a daily cap is reached: stop).
CREATE OR REPLACE FUNCTION public.record_menu_agent_step(
  p_job_id BIGINT, p_action TEXT, p_url TEXT, p_model TEXT, p_input_tokens INTEGER, p_output_tokens INTEGER, p_detail TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job   public.menu_agent_jobs%ROWTYPE;
  v_in    INTEGER := GREATEST(COALESCE(p_input_tokens, 0), 0);
  v_out   INTEGER := GREATEST(COALESCE(p_output_tokens, 0), 0);
  v_max   INTEGER := public._menu_setting('menuAgentMaxSteps', 10, 1, 50);
BEGIN
  SELECT * INTO v_job FROM public.menu_agent_jobs j WHERE j.id = p_job_id AND j.status = 'running' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF v_job.steps_taken >= v_max THEN RETURN 'max_steps'; END IF;

  INSERT INTO public.menu_agent_steps (job_id, step_no, action, url, model, input_tokens, output_tokens, detail)
  VALUES (p_job_id, v_job.steps_taken + 1, LEFT(COALESCE(NULLIF(btrim(p_action), ''), 'unknown'), 40),
          LEFT(p_url, 2000), LEFT(p_model, 100), v_in, v_out, LEFT(p_detail, 500));

  UPDATE public.menu_agent_jobs j
     SET steps_taken = j.steps_taken + 1, input_tokens = j.input_tokens + v_in, output_tokens = j.output_tokens + v_out,
         updated_at = NOW()
   WHERE j.id = p_job_id;

  IF public._menu_agent_cap_reached() THEN RETURN 'cap_reached'; END IF;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.record_menu_agent_step(BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_menu_agent_step(BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT) TO service_role;


-- Finishes a job. p_status: 'ok' (p_items holds the dishes found), 'no_items' (nothing found) or anything else = an error.
-- p_items is a JSON array of {name, description, price, source_url}. The dishes are stored as PENDING proposals only;
-- menu_items is not touched. An error is retried after 6 hours, and after menuBuildMaxAttempts tries is needs_attention.
-- Returns the job's new status, or 'unknown'.
CREATE OR REPLACE FUNCTION public.finish_menu_agent_job(p_job_id BIGINT, p_status TEXT, p_detail TEXT DEFAULT NULL, p_items JSONB DEFAULT '[]'::jsonb)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job   public.menu_agent_jobs%ROWTYPE;
  v_max   INTEGER := public._menu_setting('menuBuildMaxAttempts', 3, 1, 10);
  v_added INTEGER := 0;
  v_new   TEXT;
BEGIN
  SELECT * INTO v_job FROM public.menu_agent_jobs j WHERE j.id = p_job_id AND j.status = 'running' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;

  IF p_status = 'ok' THEN
    INSERT INTO public.menu_agent_proposals (job_id, place_id, item_name, description, price, source_url)
    SELECT p_job_id, v_job.place_id, LEFT(btrim(x.name), 200), LEFT(NULLIF(btrim(x.description), ''), 1000),
           CASE WHEN x.price >= 0 AND x.price < 100000 THEN round(x.price, 2) END, LEFT(NULLIF(btrim(x.source_url), ''), 2000)
    FROM jsonb_to_recordset(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END)
      AS x(name TEXT, description TEXT, price NUMERIC, source_url TEXT)
    WHERE btrim(COALESCE(x.name, '')) <> '';
    GET DIAGNOSTICS v_added = ROW_COUNT;
    v_new := CASE WHEN v_added > 0 THEN 'done' ELSE 'no_items' END;
  ELSIF p_status = 'no_items' THEN
    v_new := 'no_items';
  ELSE
    v_new := CASE WHEN v_job.attempts >= v_max THEN 'needs_attention' ELSE 'error' END;
  END IF;

  UPDATE public.menu_agent_jobs j
     SET status = v_new, last_detail = LEFT(p_detail, 300), finished_at = NOW(), updated_at = NOW(),
         next_attempt_at = CASE WHEN v_new = 'error' THEN NOW() + INTERVAL '6 hours'
                                WHEN v_new = 'needs_attention' THEN 'infinity'::timestamptz ELSE j.next_attempt_at END
   WHERE j.id = p_job_id;
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_menu_agent_job(BIGINT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_menu_agent_job(BIGINT, TEXT, TEXT, JSONB) TO service_role;

-- ── 6. Approval ─────────────────────────────────────────────────────────────
-- Step 1 (admin): approve or reject proposals; this only changes their status. Step 2 (the menu-agent edge function):
-- estimates nutrition for the approved dishes and merges them with merge_approved_menu_agent_proposals, which adds them
-- to the restaurant's menu the usual way (merge_place_built_items: new dishes verified, AI guesses confirmed, nothing replaced).
ALTER TABLE public.menu_agent_proposals ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;

DROP FUNCTION IF EXISTS public.admin_list_menu_agent_proposals(TEXT, INTEGER, INTEGER);

CREATE FUNCTION public.admin_list_menu_agent_proposals(p_status TEXT DEFAULT 'pending', p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0)
RETURNS TABLE (
  total_count BIGINT, id BIGINT, job_id BIGINT, place_id TEXT, restaurant_name TEXT, item_name TEXT,
  description TEXT, price NUMERIC, source_url TEXT, status TEXT, merged_at TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT COUNT(*) OVER ()::BIGINT, p.id, p.job_id, p.place_id, j.restaurant_name, p.item_name,
         p.description, p.price, p.source_url, p.status, p.merged_at, p.created_at
  FROM public.menu_agent_proposals p
  JOIN public.menu_agent_jobs j ON j.id = p.job_id
  WHERE p.status = COALESCE(NULLIF(p_status, ''), 'pending')
  ORDER BY p.created_at, p.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_menu_agent_proposals(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_menu_agent_proposals(TEXT, INTEGER, INTEGER) TO authenticated;

-- Approves or rejects PENDING proposals only (a decided one is left as it is). Returns how many changed.
CREATE OR REPLACE FUNCTION public.admin_decide_menu_agent_proposals(p_ids BIGINT[], p_approve BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed INTEGER;
BEGIN
  PERFORM public._require_admin();
  UPDATE public.menu_agent_proposals p
     SET status = CASE WHEN p_approve IS TRUE THEN 'approved' ELSE 'rejected' END,
         decided_by = auth.uid(), decided_at = NOW()
   WHERE p.id = ANY (COALESCE(p_ids, ARRAY[]::BIGINT[])) AND p.status = 'pending';
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_decide_menu_agent_proposals(BIGINT[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decide_menu_agent_proposals(BIGINT[], BOOLEAN) TO authenticated;

-- Service role only. p_items: a JSON array in the merge shape (itemId, name, calories, ...) where each item also has
-- "proposalId". Only items whose proposal is approved, not yet merged and belongs to p_place_id are merged; the rest
-- are skipped. Returns {"added": n, "confirmed": m, "skipped": k}.
CREATE OR REPLACE FUNCTION public.merge_approved_menu_agent_proposals(p_place_id TEXT, p_restaurant_name TEXT, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok      JSONB;
  v_ids     BIGINT[];
  v_total   INTEGER;
  v_result  JSONB := jsonb_build_object('added', 0, 'confirmed', 0);
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;
  v_total := jsonb_array_length(p_items);

  SELECT jsonb_agg(i), array_agg((i->>'proposalId')::BIGINT)
    INTO v_ok, v_ids
  FROM jsonb_array_elements(p_items) i
  WHERE COALESCE(i->>'proposalId', '') ~ '^[0-9]{1,18}$'
    AND EXISTS (
      SELECT 1 FROM public.menu_agent_proposals p
      WHERE p.id = (i->>'proposalId')::BIGINT AND p.place_id = p_place_id AND p.status = 'approved' AND p.merged_at IS NULL
    );

  IF v_ok IS NOT NULL THEN
    v_result := public.merge_place_built_items(p_place_id, p_restaurant_name, v_ok);
    UPDATE public.menu_agent_proposals p SET merged_at = NOW() WHERE p.id = ANY (v_ids);
  END IF;
  RETURN v_result || jsonb_build_object('skipped', v_total - COALESCE(jsonb_array_length(v_ok), 0));
END;
$$;

REVOKE ALL ON FUNCTION public.merge_approved_menu_agent_proposals(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_approved_menu_agent_proposals(TEXT, TEXT, JSONB) TO service_role;


NOTIFY pgrst, 'reload schema';


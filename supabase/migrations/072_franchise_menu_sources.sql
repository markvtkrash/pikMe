-- Where a chain's menu comes from, one row per chain (not per store). Filled on
-- demand by an edge function that looks up one store's Google place_id on
-- SerpApi, reads the chain's official menu page, and records what it found here.
-- Only small, derived facts are kept — the cleaned menu link, website, place
-- types and the dish names SerpApi lists as "highlights". Reviews, photos,
-- posts and other SerpApi payload are deliberately NOT stored.
--
-- Written to be safely re-runnable (IF NOT EXISTS / DROP-then-CREATE / ON CONFLICT).

-- ── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.franchise_menu_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id        UUID NOT NULL UNIQUE REFERENCES public.franchise_chains(id) ON DELETE CASCADE,
  -- The store whose place_id we looked up (so the source can be traced).
  source_place_id TEXT,
  -- Official menu page with tracking parameters (utm_*, y_source, olonwp...) removed.
  menu_link       TEXT,
  -- Store-specific part of the link (e.g. "store=034416"), kept separately for
  -- a possible later per-store layer.
  store_ref       TEXT,
  -- Host of the menu page, e.g. "tacobell.com".
  menu_source     TEXT,
  website         TEXT,
  place_types     TEXT[] NOT NULL DEFAULT '{}',
  -- Dish names SerpApi lists as highlights (crowd-sourced, noisy, partial).
  highlights      TEXT[] NOT NULL DEFAULT '{}',
  -- Outcome of the last lookup. 'ok' = menu items were extracted from the page.
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'ok', 'no_menu_link', 'unreadable', 'error')),
  status_detail   TEXT,
  item_count      INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  -- When the last lookup ran (successful or not) — drives the refresh period.
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.franchise_menu_sources_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_franchise_menu_sources_touch ON public.franchise_menu_sources;
CREATE TRIGGER trg_franchise_menu_sources_touch
  BEFORE UPDATE ON public.franchise_menu_sources
  FOR EACH ROW EXECUTE FUNCTION public.franchise_menu_sources_touch();

-- ── 2. Access ───────────────────────────────────────────────────────────────
-- Written only by the edge function (service role, which bypasses RLS).
-- Admins may read and manage rows from the admin app. Nobody else — the
-- consumer app never reads this table, only the menu items derived from it.
ALTER TABLE public.franchise_menu_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "franchise_menu_sources_admin_all" ON public.franchise_menu_sources;
CREATE POLICY "franchise_menu_sources_admin_all" ON public.franchise_menu_sources
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Table privileges are separate from RLS (a missing GRANT is a 403 even with a
-- permissive policy). No grant to anon.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.franchise_menu_sources TO authenticated;
GRANT ALL ON public.franchise_menu_sources TO service_role;

-- ── 3. Refresh period ───────────────────────────────────────────────────────
-- Admin-editable on the Config Management page. Not a secret, so it is fine in
-- app_config (which is publicly readable).
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('serpapiMenuRefreshDays', '30', 'How many days a chain''s SerpApi menu lookup is reused before the next customer request triggers a fresh one (1–365). Lower = fresher menus but more SerpApi credits used.', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

-- ── 4. Staleness check ──────────────────────────────────────────────────────
-- Single source of truth for "does this chain need a fresh lookup?".
--   * never fetched (NULL)                       -> stale
--   * p_days NULL / <= 0 / non-sensible          -> falls back to 30 (0 must NOT
--                                                   mean "always refresh": that
--                                                   would spend a credit per request)
--   * p_days > 365                               -> capped at 365
--   * age >= p_days days (boundary is stale)     -> stale
CREATE OR REPLACE FUNCTION public.menu_source_is_stale(
  p_fetched_at TIMESTAMPTZ,
  p_days       INTEGER,
  p_now        TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_fetched_at IS NULL THEN true
    ELSE p_now - p_fetched_at >= make_interval(
      days => LEAST(CASE WHEN p_days IS NULL OR p_days <= 0 THEN 30 ELSE p_days END, 365)
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.menu_source_is_stale(TIMESTAMPTZ, INTEGER, TIMESTAMPTZ) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

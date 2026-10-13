-- Listing eligibility: a per-restaurant flag that decides whether a restaurant may be shown to customers, kept on the server.
--
-- Today every restaurant is listed. This puts the machinery in place so that, later (for example when owners pay), a rule can mark a
-- restaurant "not eligible" and it simply stops appearing for customers, with no change to the customer app.
--
--   restaurant_listing            one row per restaurant that has been marked, keyed by Google place ID (so it covers claimed AND unclaimed
--                                 restaurants). NO row means eligible. is_eligible defaults to TRUE.
--   app_config enforceListingEligibility
--                                 the master switch, 'false' by default. While it is 'false' the flag is IGNORED and every restaurant is shown,
--                                 even one marked not eligible. 'true' makes the flag take effect.
--   _listing_enforced()           reads that switch.
--   restaurant_listing_blocked(place_id)
--                                 TRUE only when the switch is on AND the restaurant is marked not eligible.
--   restaurant_is_listed(place_id)
--                                 the one rule customer-facing paths use: not blocked by the flag, and not hidden by the older rules (a claimed
--                                 restaurant an admin closed, its owner paused, or whose owner was deactivated). A NULL place is listed.
--   ineligible_place_ids(ids)     which of the given places are blocked by the flag (one call for a whole list; used by fetch-nearby-restaurants).
--   evaluate_listing_eligibility(place_id)
--                                 WHERE THE FUTURE CONDITION GOES (for example "payment overdue"). Today it always returns TRUE.
--   refresh_listing_eligibility(place_id)
--                                 runs the condition for one place (or every claimed restaurant) and records the result, skipping a restaurant an
--                                 admin set by hand (manual_override). Service role only, for a scheduled job or a payment webhook.
--   admin_set_listing_eligibility(place_id, eligible, reason)
--                                 an admin sets a restaurant eligible / not eligible by hand (that sticks until cleared); NULL clears the override
--                                 and returns it to the automatic rule.
--   admin_get_listing_eligibility(place_id)
--                                 an admin reads one restaurant's flag.
--
-- Also: service_role could not read app_config ("permission denied for table app_config"), so the edge function never saw the admin Config
-- switches (showFranchiseRestaurants / showIndependentRestaurants) and always showed everything. That grant is added here.
--
-- Safe to re-run.

-- ── 0. The service role can read app_config ────────────────────────────────
GRANT SELECT ON public.app_config TO service_role;

-- ── 1. The master switch (off: the flag is ignored) ────────────────────────
INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('enforceListingEligibility', 'false', 'Server: when ON, a restaurant marked "not eligible" (restaurant_listing) is hidden from customers. OFF (default) = the eligibility flag is ignored and every restaurant is shown.', 'No .env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

-- ── 2. The flag, per restaurant (by place ID) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.restaurant_listing (
  google_place_id TEXT PRIMARY KEY,
  is_eligible     BOOLEAN NOT NULL DEFAULT TRUE,
  reason          TEXT,
  -- an admin set it by hand: the automatic refresh leaves it alone until an admin clears it
  manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  changed_by      TEXT NOT NULL DEFAULT 'system',
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.restaurant_listing IS
  'Per-restaurant listing eligibility, by Google place ID. No row = eligible. Only enforced while app_config enforceListingEligibility is true. Read/written through functions only.';

CREATE INDEX IF NOT EXISTS idx_restaurant_listing_ineligible
  ON public.restaurant_listing (google_place_id) WHERE is_eligible = FALSE;

ALTER TABLE public.restaurant_listing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurant_listing FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.restaurant_listing TO service_role;

-- ── 3. The switch and the rule ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._listing_enforced()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT lower(btrim(c.value)) = 'true' FROM public.app_config c WHERE c.key = 'enforceListingEligibility'), FALSE);
$$;

-- TRUE only when the switch is on and this place is marked not eligible.
CREATE OR REPLACE FUNCTION public.restaurant_listing_blocked(p_place_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._listing_enforced()
     AND EXISTS (SELECT 1 FROM public.restaurant_listing l WHERE l.google_place_id = p_place_id AND l.is_eligible = FALSE);
$$;

-- The rule customer-facing paths use. A missing place is listed (a name-only lookup, a franchise menu).
CREATE OR REPLACE FUNCTION public.restaurant_is_listed(p_place_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_place_id IS NULL
      OR p_place_id = ''
      OR (
        NOT public.restaurant_listing_blocked(p_place_id)
        AND NOT EXISTS (
          SELECT 1
          FROM public.restaurants cr
          LEFT JOIN public.restaurant_owners ro ON ro.id = cr.owner_id
          WHERE cr.google_place_id = p_place_id
            AND (cr.status = 'closed' OR cr.is_paused OR ro.is_active = FALSE)
        )
      );
$$;

-- Which of these places are blocked by the flag. One call for a whole list.
CREATE OR REPLACE FUNCTION public.ineligible_place_ids(p_place_ids TEXT[])
RETURNS TABLE (google_place_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.google_place_id
  FROM public.restaurant_listing l
  WHERE public._listing_enforced()
    AND l.is_eligible = FALSE
    AND l.google_place_id = ANY (p_place_ids[1:1000]);
$$;

REVOKE ALL ON FUNCTION public._listing_enforced() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restaurant_listing_blocked(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restaurant_is_listed(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ineligible_place_ids(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restaurant_is_listed(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ineligible_place_ids(TEXT[]) TO authenticated, service_role;

-- ── 4. The future condition (a stub: everyone is eligible) ─────────────────
-- Replace the body when there is a real rule (for example "the owner's subscription is current"). Return FALSE to mark a restaurant
-- not eligible. The reason is recorded by refresh_listing_eligibility.
CREATE OR REPLACE FUNCTION public.evaluate_listing_eligibility(p_place_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT TRUE;
$$;

REVOKE ALL ON FUNCTION public.evaluate_listing_eligibility(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_listing_eligibility(TEXT) TO service_role;

-- Runs the condition for one place, or for every claimed restaurant when no place is given, and records the result. A restaurant an admin set
-- by hand is skipped. Returns how many rows changed. Meant for a scheduled job or a payment webhook (service role).
CREATE OR REPLACE FUNCTION public.refresh_listing_eligibility(p_place_id TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_place   TEXT;
  v_ok      BOOLEAN;
  v_changed INTEGER := 0;
  v_rows    INTEGER;
BEGIN
  FOR v_place IN
    SELECT google_place_id FROM (
      SELECT p_place_id AS google_place_id WHERE p_place_id IS NOT NULL
      UNION
      SELECT r.google_place_id FROM public.restaurants r WHERE p_place_id IS NULL
    ) x
  LOOP
    IF EXISTS (SELECT 1 FROM public.restaurant_listing l WHERE l.google_place_id = v_place AND l.manual_override) THEN
      CONTINUE;
    END IF;
    v_ok := COALESCE(public.evaluate_listing_eligibility(v_place), TRUE);
    INSERT INTO public.restaurant_listing (google_place_id, is_eligible, reason, manual_override, changed_by, changed_at)
    VALUES (v_place, v_ok, CASE WHEN v_ok THEN NULL ELSE 'Did not meet the listing condition' END, FALSE, 'system', NOW())
    ON CONFLICT (google_place_id) DO UPDATE
      SET is_eligible = EXCLUDED.is_eligible,
          reason      = EXCLUDED.reason,
          changed_by  = 'system',
          changed_at  = NOW()
      WHERE public.restaurant_listing.is_eligible IS DISTINCT FROM EXCLUDED.is_eligible;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_changed := v_changed + v_rows;
  END LOOP;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_listing_eligibility(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_listing_eligibility(TEXT) TO service_role;

-- ── 5. Admin: set a restaurant by hand ─────────────────────────────────────
-- p_eligible TRUE / FALSE sets it and keeps it (an automatic refresh will not change it). NULL clears the hand setting and puts the
-- restaurant back to the automatic rule.
CREATE OR REPLACE FUNCTION public.admin_set_listing_eligibility(
  p_place_id TEXT,
  p_eligible BOOLEAN,
  p_reason   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  PERFORM public._require_admin();
  IF p_place_id IS NULL OR btrim(p_place_id) = '' THEN
    RAISE EXCEPTION 'A place is required';
  END IF;

  IF p_eligible IS NULL THEN
    -- back to the automatic rule
    v_ok := COALESCE(public.evaluate_listing_eligibility(p_place_id), TRUE);
    INSERT INTO public.restaurant_listing (google_place_id, is_eligible, reason, manual_override, changed_by, changed_at)
    VALUES (p_place_id, v_ok, CASE WHEN v_ok THEN NULL ELSE 'Did not meet the listing condition' END, FALSE, 'admin:' || COALESCE(auth.uid()::text, '?'), NOW())
    ON CONFLICT (google_place_id) DO UPDATE
      SET is_eligible = EXCLUDED.is_eligible, reason = EXCLUDED.reason, manual_override = FALSE,
          changed_by = EXCLUDED.changed_by, changed_at = NOW();
  ELSE
    INSERT INTO public.restaurant_listing (google_place_id, is_eligible, reason, manual_override, changed_by, changed_at)
    VALUES (p_place_id, p_eligible, NULLIF(btrim(COALESCE(p_reason, '')), ''), TRUE, 'admin:' || COALESCE(auth.uid()::text, '?'), NOW())
    ON CONFLICT (google_place_id) DO UPDATE
      SET is_eligible = EXCLUDED.is_eligible, reason = EXCLUDED.reason, manual_override = TRUE,
          changed_by = EXCLUDED.changed_by, changed_at = NOW();
  END IF;

  RETURN public.admin_get_listing_eligibility(p_place_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_listing_eligibility(p_place_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.restaurant_listing%ROWTYPE;
BEGIN
  PERFORM public._require_admin();
  SELECT * INTO v_row FROM public.restaurant_listing l WHERE l.google_place_id = p_place_id;
  RETURN jsonb_build_object(
    'placeId',        p_place_id,
    'isEligible',     COALESCE(v_row.is_eligible, TRUE),
    'hasRow',         v_row.google_place_id IS NOT NULL,
    'reason',         v_row.reason,
    'manualOverride', COALESCE(v_row.manual_override, FALSE),
    'changedBy',      v_row.changed_by,
    'changedAt',      v_row.changed_at,
    'enforced',       public._listing_enforced()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_listing_eligibility(TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_listing_eligibility(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_listing_eligibility(TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_listing_eligibility(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

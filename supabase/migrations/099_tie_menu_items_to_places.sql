-- Tie existing menu items to a place (menu_items.place_id), where that can be done without guessing.
--
-- Until now every menu item is stored by restaurant NAME (place_id NULL). The customer lookup already
-- reads a location's own rows first (migration 067), so tying items to the right place makes a
-- restaurant show its own menu instead of one shared with every restaurant of the same name.
--
-- What is tied (only when it is unambiguous):
--   * the restaurant is CLAIMED and approved, is not a franchise chain, and its name (normalized) belongs to
--     exactly one restaurant record, so there is no second claim to confuse it with;
--   * items stored under that exact name (ignoring case) with no place yet;
--   * if other cached locations share the name, ONLY the verified items (entered by the owner or an admin) are
--     tied, because the unverified AI guesses may belong to any of them; if the name is unique, all of its
--     items are tied.
-- What is never touched: franchise chains (their menu stays shared by chain), names claimed more than once,
-- restaurants nobody has claimed, and items that already have a place. Item ids do not change, so coupons and
-- customers' saved items keep working.
--
-- Run it from the SQL editor (not callable from the apps):
--   SELECT public.tie_menu_items_to_places();        -- DRY RUN: only reports what it would do
--   SELECT public.tie_menu_items_to_places(false);   -- does it, and records every row in menu_items_place_tie_log
--   SELECT public.untie_menu_items_from_places();    -- undoes everything recorded in that log
-- Safe to re-run. Take a backup before the real run.

-- ── 1. What was tied (so it can be undone) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_items_place_tie_log (
  item_id         TEXT PRIMARY KEY,
  restaurant_name TEXT NOT NULL,
  place_id        TEXT NOT NULL,
  tied_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.menu_items_place_tie_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_items_place_tie_log FROM PUBLIC, anon, authenticated;

-- ── 2. The rows that qualify ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._menu_tie_targets()
RETURNS TABLE (
  item_id         TEXT,
  restaurant_name TEXT,
  place_id        TEXT,
  is_verified     BOOLEAN,
  restaurant_id   UUID
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH claimed AS (
    SELECT r.id, r.google_place_id AS place_id, r.name,
           public.normalize_restaurant_name(r.name) AS norm
    FROM public.restaurants r
    WHERE r.status = 'approved'
      AND r.google_place_id IS NOT NULL
      AND public.normalize_restaurant_name(r.name) <> ''
      AND NOT public.is_franchise_chain(r.name)
  ),
  one_claim AS (
    -- the name belongs to a single restaurant record (any status), so it cannot be someone else's
    SELECT c.* FROM claimed c
    WHERE (SELECT COUNT(*) FROM public.restaurants r2
           WHERE public.normalize_restaurant_name(r2.name) = c.norm) = 1
  ),
  shared AS (
    SELECT c.id,
           EXISTS (SELECT 1 FROM public.cached_restaurants cr
                   WHERE public.normalize_restaurant_name(cr.name) = c.norm AND cr.place_id <> c.place_id) AS has_others
    FROM one_claim c
  )
  SELECT mi.item_id, mi.restaurant_name, c.place_id, COALESCE(mi.is_verified, false), c.id
  FROM public.menu_items mi
  JOIN one_claim c ON lower(btrim(mi.restaurant_name)) = lower(btrim(c.name))
  JOIN shared s ON s.id = c.id
  WHERE mi.place_id IS NULL
    AND (NOT s.has_others OR COALESCE(mi.is_verified, false));
$$;

REVOKE ALL ON FUNCTION public._menu_tie_targets() FROM PUBLIC, anon, authenticated;

-- ── 3. Tie (dry run by default) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tie_menu_items_to_places(p_dry_run BOOLEAN DEFAULT TRUE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows        INTEGER;
  v_verified    INTEGER;
  v_restaurants INTEGER;
  v_skipped     INTEGER;
  v_sample      JSONB;
  v_tied        INTEGER := 0;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE t.is_verified), COUNT(DISTINCT t.restaurant_id)
    INTO v_rows, v_verified, v_restaurants
  FROM public._menu_tie_targets() t;

  -- claimed, approved, non-franchise restaurants left alone because their name is shared with another record
  SELECT COUNT(*) INTO v_skipped
  FROM public.restaurants r
  WHERE r.status = 'approved' AND NOT public.is_franchise_chain(r.name)
    AND (SELECT COUNT(*) FROM public.restaurants r2
         WHERE public.normalize_restaurant_name(r2.name) = public.normalize_restaurant_name(r.name)) > 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('restaurant', s.name, 'items', s.n) ORDER BY s.n DESC), '[]'::jsonb)
    INTO v_sample
  FROM (
    SELECT t.restaurant_name AS name, COUNT(*) AS n
    FROM public._menu_tie_targets() t GROUP BY t.restaurant_name ORDER BY COUNT(*) DESC LIMIT 10
  ) s;

  IF NOT COALESCE(p_dry_run, TRUE) THEN
    INSERT INTO public.menu_items_place_tie_log (item_id, restaurant_name, place_id)
    SELECT t.item_id, t.restaurant_name, t.place_id FROM public._menu_tie_targets() t
    ON CONFLICT (item_id) DO NOTHING;

    UPDATE public.menu_items mi
    SET place_id = t.place_id
    FROM public._menu_tie_targets() t
    WHERE mi.item_id = t.item_id AND mi.place_id IS NULL;
    GET DIAGNOSTICS v_tied = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'dryRun', COALESCE(p_dry_run, TRUE),
    'restaurantsToTie', v_restaurants,
    'itemsToTie', v_rows,
    'verifiedItems', v_verified,
    'unverifiedItems', v_rows - v_verified,
    'skippedSharedNameRestaurants', v_skipped,
    'itemsTied', v_tied,
    'largest', v_sample
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tie_menu_items_to_places(BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ── 4. Undo ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.untie_menu_items_from_places()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- only rows still on the place this script gave them
  UPDATE public.menu_items mi
  SET place_id = NULL
  FROM public.menu_items_place_tie_log l
  WHERE mi.item_id = l.item_id AND mi.place_id = l.place_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM public.menu_items_place_tie_log;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.untie_menu_items_from_places() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Franchise Menu Management: stores for the Google lookup.
--
--   1. admin_list_chain_menu_sources also returns the chain's stored store place ID
--      (source_place_id) and whether ANY store of the chain is known (has_store: a stored place ID,
--      or a store seen in a customer search, or a claimed restaurant), as the last two columns.
--      The page uses them to show "no store seen yet" and to fill the Store section of the Manage
--      window. The return shape gains columns, so the function is dropped and recreated; the rest
--      (rows, admin-only check, ordering) is unchanged.
--   2. admin_set_chain_place_id saves (or, blank, removes) the store whose Google place ID the
--      chain's lookup uses, and marks the chain due for a fresh lookup. Returns a JSON warning when
--      the store's name does not match this chain on the franchise list (a different business would
--      give another menu); the save still happens, so the admin decides.
--   3. chains_needing_menu_build (087) also queues chains that have a built-in menu page, so the
--      scheduled job can build them without a store (the lookup then reads that page directly).
--
-- SECURITY DEFINER + _require_admin(), signed-in users only for the admin functions. Safe to re-run.

-- ── 1. List ─────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_chain_menu_sources();

CREATE FUNCTION public.admin_list_chain_menu_sources()
RETURNS TABLE (
  chain_id          UUID,
  chain_name        TEXT,
  category          TEXT,
  status            TEXT,
  status_detail     TEXT,
  menu_link         TEXT,
  store_ref         TEXT,
  menu_link_manual  BOOLEAN,
  website           TEXT,
  item_count        INTEGER,
  fetched_at        TIMESTAMPTZ,
  current_items     BIGINT,
  built_in_menu_url TEXT,
  source_place_id   TEXT,
  has_store         BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  WITH seen AS (
    -- the names of stores seen in searches or claimed, normalized once (not once per chain)
    SELECT DISTINCT public.normalize_restaurant_name(cr.name) AS n
    FROM public.cached_restaurants cr WHERE cr.place_id IS NOT NULL
    UNION
    SELECT DISTINCT public.normalize_restaurant_name(r.name)
    FROM public.restaurants r WHERE r.google_place_id IS NOT NULL
  )
  SELECT
    fc.id,
    fc.name,
    fc.category,
    COALESCE(s.status, 'not_started'),
    s.status_detail,
    s.menu_link,
    s.store_ref,
    COALESCE(s.menu_link_manual, false),
    s.website,
    COALESCE(s.item_count, 0),
    s.fetched_at,
    -- Chain-sourced items currently shown to customers for this chain.
    (SELECT COUNT(*) FROM public.menu_items mi
      WHERE mi.restaurant_name = fc.name
        AND mi.place_id IS NULL
        AND mi.item_id LIKE 'chain\_%' ESCAPE '\'),
    fc.menu_url,
    s.source_place_id,
    (s.source_place_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM seen WHERE seen.n = fc.normalized_name)
      OR EXISTS (SELECT 1 FROM unnest(fc.aliases) a, seen WHERE seen.n = public.normalize_restaurant_name(a)))
  FROM public.franchise_chains fc
  LEFT JOIN public.franchise_menu_sources s ON s.chain_id = fc.id
  WHERE fc.is_active
  ORDER BY fc.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_chain_menu_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_chain_menu_sources() TO authenticated;

-- ── 2. Set or remove the store ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_chain_place_id(
  p_chain_id   UUID,
  p_place_id   TEXT,
  p_store_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_place   TEXT := NULLIF(btrim(COALESCE(p_place_id, '')), '');
  v_name    TEXT := NULLIF(btrim(COALESCE(p_store_name, '')), '');
  v_matched UUID;
  v_warning TEXT;
BEGIN
  PERFORM public._require_admin();

  IF NOT EXISTS (SELECT 1 FROM public.franchise_chains WHERE id = p_chain_id) THEN
    RAISE EXCEPTION 'Chain not found';
  END IF;

  -- Blank removes the stored store (a store seen in a customer search can still be used).
  IF v_place IS NULL THEN
    UPDATE public.franchise_menu_sources SET source_place_id = NULL WHERE chain_id = p_chain_id;
    RETURN jsonb_build_object('saved', true, 'removed', true, 'warning', NULL);
  END IF;

  IF v_place !~ '^[A-Za-z0-9_-]{10,200}$' THEN
    RAISE EXCEPTION 'That does not look like a Google place ID (letters, numbers, - and _, 10 to 200 characters)';
  END IF;

  -- The store's name: the one given (picked from a search), else one we already know for this place.
  IF v_name IS NULL THEN
    SELECT cr.name INTO v_name FROM public.cached_restaurants cr WHERE cr.place_id = v_place LIMIT 1;
  END IF;
  IF v_name IS NULL THEN
    SELECT r.name INTO v_name FROM public.restaurants r WHERE r.google_place_id = v_place LIMIT 1;
  END IF;
  IF v_name IS NOT NULL THEN
    SELECT m.id INTO v_matched FROM public.find_franchise_chain(v_name) m;
    IF v_matched IS DISTINCT FROM p_chain_id THEN
      v_warning := 'Google lists this store as "' || v_name || '", which the franchise list does not match to this chain. Check it is the right business.';
    END IF;
  END IF;

  -- Store it and mark the chain due. A chain with no row yet gets one, due and not "running".
  INSERT INTO public.franchise_menu_sources (chain_id, source_place_id, status, fetched_at, updated_at)
  VALUES (p_chain_id, v_place, 'pending', NOW() - INTERVAL '400 days', NOW() - INTERVAL '1 hour')
  ON CONFLICT (chain_id) DO UPDATE
    SET source_place_id = EXCLUDED.source_place_id,
        fetched_at = EXCLUDED.fetched_at;

  RETURN jsonb_build_object('saved', true, 'removed', false, 'warning', v_warning);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_chain_place_id(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_chain_place_id(UUID, TEXT, TEXT) TO authenticated;

-- ── 3. Queue: a built-in menu page is enough ────────────────────────────────
CREATE OR REPLACE FUNCTION public.chains_needing_menu_build(
  p_limit INTEGER DEFAULT 3,
  p_days  INTEGER DEFAULT NULL
)
RETURNS TABLE (chain_id UUID, chain_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := p_days;
BEGIN
  IF v_days IS NULL THEN
    SELECT CASE WHEN c.value ~ '^[0-9]{1,4}$' THEN c.value::INTEGER ELSE NULL END
      INTO v_days FROM public.app_config c WHERE c.key = 'serpapiMenuRefreshDays';
  END IF;
  v_days := COALESCE(v_days, 30);

  RETURN QUERY
  SELECT fc.id, fc.name
  FROM public.franchise_chains fc
  LEFT JOIN public.franchise_menu_sources s ON s.chain_id = fc.id
  WHERE fc.is_active
    AND (
      s.id IS NULL
      OR (
        public.menu_source_is_stale(s.fetched_at, v_days)
        -- a lookup that started minutes ago is still running
        AND NOT (s.status = 'pending' AND s.updated_at > NOW() - INTERVAL '10 minutes')
      )
    )
    AND (
      (s.menu_link_manual AND s.menu_link IS NOT NULL)
      OR s.source_place_id IS NOT NULL
      -- a built-in menu page needs no store: the lookup reads it directly
      OR fc.menu_url IS NOT NULL
      OR public.find_chain_place_id(fc.id) IS NOT NULL
    )
  ORDER BY (s.id IS NULL) DESC, s.fetched_at ASC NULLS FIRST, fc.name
  LIMIT GREATEST(COALESCE(p_limit, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.chains_needing_menu_build(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chains_needing_menu_build(INTEGER, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';

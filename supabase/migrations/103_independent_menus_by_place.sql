-- Independent restaurants show only items tied to their own place; builds replace a place's pulled menu.
--
-- 1. get_menu_items_for_restaurant (067/086): an independent restaurant gets ONLY the items tied to its place ID.
--    The fallback to "any items with the same restaurant name" is gone for independents, so a menu is never shown
--    because two restaurants share a name. A franchise keeps the shared chain menu (exact-name rows first, else the
--    chain's), as before.
--      !! Items still stored by name (for example the ten claimed restaurants' items) stop showing to customers
--      !! until they are tied to a place. Run  SELECT public.tie_menu_items_to_places(false);  (migration 099)
--      !! BEFORE applying this migration.
-- 2. enqueue_menu_build (101): a place counts as "already built" only if it has items other than AI guesses.
-- 3. delete_place_pulled_items: removes a place's PULLED items (ids pull_...) and its AI guesses (ai_...), verified or
--    not. Hand-entered items (manual_, image_, text_, link_) are never touched.
-- 4. replace_place_pulled_items (102): the build's result replaces the place's pulled items and AI guesses, adds only
--    dishes whose names are not already on the menu (case and spaces ignored), and keeps hand-entered items.
-- Safe to re-run.

-- ── 1. The customer lookup ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_menu_items_for_restaurant(
  p_place_id TEXT,
  p_restaurant_name TEXT
)
RETURNS SETOF public.menu_items
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_chain_name TEXT;
BEGIN
  -- 1. the place's own items (the whole menu of that one location)
  IF p_place_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.menu_items mi WHERE mi.place_id = p_place_id
  ) THEN
    RETURN QUERY
    SELECT mi.*
    FROM public.menu_items mi
    WHERE mi.place_id = p_place_id
      AND mi.is_out_of_stock = FALSE;
    RETURN;
  END IF;

  -- 2. a franchise shares one chain menu; an independent has nothing without items of its own
  SELECT c.name INTO v_chain_name FROM public.find_franchise_chain(p_restaurant_name) c;
  IF v_chain_name IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.place_id IS NULL AND mi.restaurant_name = p_restaurant_name
  ) THEN
    p_restaurant_name := v_chain_name;
  END IF;

  RETURN QUERY
  SELECT mi.*
  FROM public.menu_items mi
  WHERE mi.place_id IS NULL
    AND mi.restaurant_name = p_restaurant_name
    AND mi.is_out_of_stock = FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_items_for_restaurant(TEXT, TEXT) TO anon, authenticated;

-- ── 2. The queue: AI guesses are not a built menu ───────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_menu_build(p_place_id TEXT, p_restaurant_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chain      UUID;
  v_chain_name TEXT;
  v_name       TEXT := btrim(COALESCE(p_restaurant_name, ''));
  v_waiting    INTEGER;
  v_inserted   BOOLEAN;
BEGIN
  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' OR v_name = '' THEN
    RETURN 'invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cached_restaurants cr WHERE cr.place_id = p_place_id) THEN
    RETURN 'unknown_place';
  END IF;

  SELECT m.id, m.name INTO v_chain, v_chain_name FROM public.find_franchise_chain(v_name) m;

  IF v_chain IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.franchise_menu_sources s WHERE s.chain_id = v_chain AND s.status = 'ok') THEN
      RETURN 'already_built';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.menu_build_queue q WHERE q.kind = 'chain' AND q.chain_id = v_chain) THEN
      SELECT COUNT(*) INTO v_waiting FROM public.menu_build_queue q WHERE q.status = 'waiting';
      IF v_waiting >= public._menu_setting('menuQueueMaxWaiting', 5000, 1, 1000000) THEN RETURN 'queue_full'; END IF;
    END IF;
    INSERT INTO public.menu_build_queue (kind, chain_id, restaurant_name)
    VALUES ('chain', v_chain, v_chain_name)
    ON CONFLICT (chain_id) WHERE kind = 'chain' DO UPDATE
      SET requested_count = public.menu_build_queue.requested_count + 1, updated_at = NOW()
    RETURNING (xmax = 0) INTO v_inserted;
    RETURN CASE WHEN v_inserted THEN 'queued' ELSE 'already_queued' END;
  END IF;

  -- an independent that already has items other than AI guesses has a real menu
  IF EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.place_id = p_place_id AND mi.item_id NOT LIKE 'ai\_%' ESCAPE '\'
  ) THEN
    RETURN 'already_built';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.menu_build_queue q WHERE q.kind = 'place' AND q.place_id = p_place_id) THEN
    SELECT COUNT(*) INTO v_waiting FROM public.menu_build_queue q WHERE q.status = 'waiting';
    IF v_waiting >= public._menu_setting('menuQueueMaxWaiting', 5000, 1, 1000000) THEN RETURN 'queue_full'; END IF;
  END IF;
  INSERT INTO public.menu_build_queue (kind, place_id, restaurant_name)
  VALUES ('place', p_place_id, v_name)
  ON CONFLICT (place_id) WHERE kind = 'place' DO UPDATE
    SET requested_count = public.menu_build_queue.requested_count + 1, updated_at = NOW()
  RETURNING (xmax = 0) INTO v_inserted;
  RETURN CASE WHEN v_inserted THEN 'queued' ELSE 'already_queued' END;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_menu_build(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_menu_build(TEXT, TEXT) TO service_role;

-- ── 3. Remove a place's pulled items and AI guesses ─────────────────────────
CREATE OR REPLACE FUNCTION public.delete_place_pulled_items(p_place_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' THEN
    RAISE EXCEPTION 'A valid Google place ID is required';
  END IF;
  DELETE FROM public.menu_items mi
  WHERE mi.place_id = p_place_id
    AND (mi.item_id LIKE 'pull\_%' ESCAPE '\' OR mi.item_id LIKE 'ai\_%' ESCAPE '\');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_place_pulled_items(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_place_pulled_items(TEXT) TO service_role;

-- ── 4. The build's result replaces the pulled menu ──────────────────────────
-- One transaction: if the save fails, the delete is undone too. Dishes whose names are already on the menu (the
-- hand-entered ones that stay) are not added again. Returns how many items were saved.
CREATE OR REPLACE FUNCTION public.replace_place_pulled_items(
  p_place_id        TEXT,
  p_restaurant_name TEXT,
  p_items           JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  PERFORM public.delete_place_pulled_items(p_place_id);

  SELECT COALESCE(jsonb_agg(i), '[]'::jsonb) INTO v_items
  FROM jsonb_array_elements(p_items) AS i
  WHERE NOT EXISTS (
    SELECT 1 FROM public.menu_items m
    WHERE m.place_id = p_place_id AND lower(btrim(m.name)) = lower(btrim(i->>'name'))
  );

  RETURN public.upsert_place_menu_items(p_place_id, p_restaurant_name, v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_place_pulled_items(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_place_pulled_items(TEXT, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

-- A successful build for an independent restaurant only ADDS to its menu.
--
--   * a built dish that matches an existing AI-GENERATED item of the place (same name, case and spaces ignored) does
--     not add a second copy: that AI item is marked VERIFIED;
--   * a built dish that matches an item already on the menu in any other way (hand-entered, or from an earlier build)
--     is left as it is;
--   * every dish that is new is added, marked VERIFIED.
--   Nothing is deleted. (A build that finds nothing still removes the place's pulled items and AI guesses:
--   delete_place_pulled_items, migration 103.)
--
-- Returns {"added": n, "confirmed": m}: how many new dishes were added and how many AI items were marked verified.
-- Service role only (the edge function). The older replace_place_pulled_items (102/103) is no longer used by builds.
-- Safe to re-run.
CREATE OR REPLACE FUNCTION public.merge_place_built_items(
  p_place_id        TEXT,
  p_restaurant_name TEXT,
  p_items           JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirmed INTEGER;
  v_new       JSONB;
  v_added     INTEGER := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  -- 1. an AI guess that a built dish matches is confirmed instead of being added again
  UPDATE public.menu_items m
  SET is_verified = TRUE
  WHERE m.place_id = p_place_id
    AND m.item_id LIKE 'ai\_%' ESCAPE '\'
    AND COALESCE(m.is_verified, FALSE) = FALSE
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE lower(btrim(i->>'name')) = lower(btrim(m.name))
    );
  GET DIAGNOSTICS v_confirmed = ROW_COUNT;

  -- 2. every dish not already on the menu is added, verified (one per name)
  SELECT jsonb_agg(jsonb_set(d.item, '{isVerified}', 'true'::jsonb))
    INTO v_new
  FROM (
    SELECT DISTINCT ON (lower(btrim(i->>'name'))) i AS item
    FROM jsonb_array_elements(p_items) i
    WHERE btrim(COALESCE(i->>'name', '')) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.menu_items m
        WHERE m.place_id = p_place_id AND lower(btrim(m.name)) = lower(btrim(i->>'name'))
      )
    ORDER BY lower(btrim(i->>'name'))
  ) d;

  IF v_new IS NOT NULL THEN
    v_added := public.upsert_place_menu_items(p_place_id, p_restaurant_name, v_new);
  END IF;

  RETURN jsonb_build_object('added', v_added, 'confirmed', v_confirmed);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_place_built_items(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_place_built_items(TEXT, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

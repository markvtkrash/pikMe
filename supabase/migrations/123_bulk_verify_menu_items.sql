-- Confirm many menu items in one step (the "Confirm Selected" button on the owner's Edit Menu and the admin's menu editor).
--
--   verify_menu_items(ids)        an owner confirms (marks verified) several items of THEIR restaurant. Every item must be the
--                                 caller's own, and not a franchise's, or nothing is changed. Returns how many were changed.
--   admin_verify_menu_items(ids)  the same for an admin, any non-franchise restaurant's items. Returns how many were changed.
--
-- The single-item functions (verify_menu_item, unverify_menu_item) are unchanged. At most 500 items per call.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.verify_menu_items(p_item_ids TEXT[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total   INTEGER;
  v_allowed INTEGER;
  v_changed INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized to modify these menu items';
  END IF;
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_item_ids) > 500 THEN
    RAISE EXCEPTION 'Confirm at most 500 items at a time';
  END IF;

  SELECT COUNT(*) INTO v_total FROM public.menu_items mi WHERE mi.item_id = ANY(p_item_ids);

  -- the caller's own items, none of them a franchise's
  SELECT COUNT(*) INTO v_allowed
  FROM public.menu_items mi
  WHERE mi.item_id = ANY(p_item_ids)
    AND NOT public.is_franchise_chain(mi.restaurant_name)
    AND EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.owner_id = auth.uid()
        AND CASE WHEN mi.place_id IS NOT NULL
                 THEN r.google_place_id = mi.place_id
                 ELSE lower(trim(r.name)) = lower(trim(mi.restaurant_name)) END
    );

  IF v_total = 0 OR v_allowed <> v_total THEN
    RAISE EXCEPTION 'Not authorized to modify these menu items';
  END IF;

  UPDATE public.menu_items mi SET is_verified = TRUE
  WHERE mi.item_id = ANY(p_item_ids) AND NOT mi.is_verified;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_menu_items(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_menu_items(TEXT[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_verify_menu_items(p_item_ids TEXT[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed INTEGER;
BEGIN
  PERFORM public._require_admin();
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_item_ids) > 500 THEN
    RAISE EXCEPTION 'Confirm at most 500 items at a time';
  END IF;

  UPDATE public.menu_items mi SET is_verified = TRUE
  WHERE mi.item_id = ANY(p_item_ids) AND NOT mi.is_verified;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_verify_menu_items(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_menu_items(TEXT[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

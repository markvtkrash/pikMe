-- Admin bulk delete for the franchise / non-franchise cache reports (063).
-- Removes the selected restaurants from the customer cache plus the data that
-- depends on them, in one transaction, and reports what was removed.
--
-- What is deleted for each selected restaurant:
--   * saved_restaurants rows for it (the only real foreign key onto
--     cached_restaurants — non-cascading, so it has to go first)
--   * its cached_restaurants row
--   * ALL of its cached menu_items, verified and unverified (once the
--     restaurant is gone they'd be orphaned), and through the existing
--     ON DELETE CASCADE (030/034) any saved_menu_items pointing at them.
--     item_analysis lives on menu_items.
--
-- What is deliberately NOT deleted:
--   * Owner-claimed restaurants (a matching row in public.restaurants) are
--     skipped entirely — their menu and coupons belong to an owner and must
--     not be wiped from a report page.
--   * Menu items that other cached locations still use. menu_items is keyed
--     by restaurant NAME, not place id, so deleting one "Subway" location must
--     not delete the menu every other Subway location relies on; items are
--     only removed once no remaining cached restaurant shares the name.
--
-- A deleted restaurant simply reappears in the cache the next time someone
-- searches near it; this is cleanup, not a block list.
CREATE OR REPLACE FUNCTION public.admin_delete_cached_restaurants(p_place_ids TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_requested        INTEGER;
  v_targets          TEXT[];
  v_skipped_claimed  INTEGER;
  v_saved_restaurants INTEGER := 0;
  v_menu_items       INTEGER := 0;
  v_verified_items   INTEGER := 0;
  v_restaurants      INTEGER := 0;
BEGIN
  PERFORM public._require_admin();

  IF p_place_ids IS NULL OR cardinality(p_place_ids) = 0 THEN
    RETURN jsonb_build_object(
      'requested', 0, 'deletedRestaurants', 0, 'skippedClaimed', 0,
      'deletedSavedRestaurants', 0, 'deletedMenuItems', 0, 'deletedVerifiedMenuItems', 0
    );
  END IF;

  SELECT COUNT(*) INTO v_requested
  FROM public.cached_restaurants cr
  WHERE cr.place_id = ANY(p_place_ids);

  -- Cached rows that are not claimed by an owner.
  SELECT COALESCE(array_agg(cr.place_id), '{}') INTO v_targets
  FROM public.cached_restaurants cr
  WHERE cr.place_id = ANY(p_place_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.restaurants r WHERE r.google_place_id = cr.place_id
    );

  v_skipped_claimed := v_requested - cardinality(v_targets);

  -- Menu items (verified or not) whose restaurant name is no longer used by
  -- any cached restaurant we are keeping, and isn't an owner-claimed name.
  WITH deleted AS (
    DELETE FROM public.menu_items mi
    WHERE mi.restaurant_name IN (
        SELECT cr.name FROM public.cached_restaurants cr WHERE cr.place_id = ANY(v_targets)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.cached_restaurants other
        WHERE other.name = mi.restaurant_name AND NOT (other.place_id = ANY(v_targets))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.restaurants r WHERE r.name = mi.restaurant_name
      )
    RETURNING COALESCE(mi.is_verified, false) AS was_verified
  )
  SELECT COUNT(*), COUNT(*) FILTER (WHERE was_verified)
  INTO v_menu_items, v_verified_items
  FROM deleted;

  DELETE FROM public.saved_restaurants WHERE place_id = ANY(v_targets);
  GET DIAGNOSTICS v_saved_restaurants = ROW_COUNT;

  DELETE FROM public.cached_restaurants WHERE place_id = ANY(v_targets);
  GET DIAGNOSTICS v_restaurants = ROW_COUNT;

  RETURN jsonb_build_object(
    'requested', v_requested,
    'deletedRestaurants', v_restaurants,
    'skippedClaimed', v_skipped_claimed,
    'deletedSavedRestaurants', v_saved_restaurants,
    'deletedMenuItems', v_menu_items,
    'deletedVerifiedMenuItems', v_verified_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_cached_restaurants(TEXT[]) TO authenticated;

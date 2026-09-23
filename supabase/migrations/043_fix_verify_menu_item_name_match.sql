-- Migration: 043_fix_verify_menu_item_name_match
-- Purpose: verify_menu_item's ownership check compared menu_items.restaurant_name
--          to restaurants.name with a raw exact match, while every other path
--          that reads/writes these items (getRestaurantMenuItems,
--          replace-restaurant-menu-items) deliberately uses a fuzzy
--          ilike('%firstword%') match instead, to tolerate small formatting
--          differences between how a restaurant's name was claimed vs. how it
--          got stored on a given menu item row. The result: an owner could see
--          and manage their own items fine, but verifying any of them failed
--          with "Not authorized to modify this menu item" on every item, on
--          both the AI Pull and Manual Entry pages, whenever that formatting
--          differed even slightly (whitespace, casing, punctuation). This
--          normalizes both sides (trim + lowercase) instead of switching to
--          the fuzzy substring match, which would risk matching a different
--          restaurant that happens to share a first word.
--
--          unverify_menu_item (035) and delete_menu_item (036) share the
--          exact same ownership-check code and would fail the exact same
--          way, so both get the identical fix here too.
-- Date: 2026-09-22

CREATE OR REPLACE FUNCTION public.verify_menu_item(p_item_id TEXT, p_new_name TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_restaurant_name TEXT;
  v_owner_id        UUID;
BEGIN
  SELECT restaurant_name INTO v_restaurant_name
  FROM public.menu_items
  WHERE item_id = p_item_id;

  IF v_restaurant_name IS NULL THEN
    RAISE EXCEPTION 'Menu item not found';
  END IF;

  SELECT owner_id INTO v_owner_id
  FROM public.restaurants
  WHERE lower(trim(name)) = lower(trim(v_restaurant_name))
  LIMIT 1;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to modify this menu item';
  END IF;

  IF p_new_name IS NOT NULL AND trim(p_new_name) <> '' THEN
    UPDATE public.menu_items SET name = trim(p_new_name), is_verified = TRUE WHERE item_id = p_item_id;
  ELSE
    UPDATE public.menu_items SET is_verified = TRUE WHERE item_id = p_item_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.verify_menu_item(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.unverify_menu_item(p_item_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_restaurant_name TEXT;
  v_owner_id        UUID;
BEGIN
  SELECT restaurant_name INTO v_restaurant_name
  FROM public.menu_items
  WHERE item_id = p_item_id;

  IF v_restaurant_name IS NULL THEN
    RAISE EXCEPTION 'Menu item not found';
  END IF;

  SELECT owner_id INTO v_owner_id
  FROM public.restaurants
  WHERE lower(trim(name)) = lower(trim(v_restaurant_name))
  LIMIT 1;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to modify this menu item';
  END IF;

  UPDATE public.menu_items SET is_verified = FALSE WHERE item_id = p_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.unverify_menu_item(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_menu_item(p_item_id TEXT, p_force BOOLEAN DEFAULT FALSE)
RETURNS JSONB AS $$
DECLARE
  v_restaurant_name TEXT;
  v_owner_id         UUID;
  v_affected_coupons JSONB;
BEGIN
  SELECT restaurant_name INTO v_restaurant_name
  FROM public.menu_items
  WHERE item_id = p_item_id;

  IF v_restaurant_name IS NULL THEN
    RAISE EXCEPTION 'Menu item not found';
  END IF;

  SELECT owner_id INTO v_owner_id
  FROM public.restaurants
  WHERE lower(trim(name)) = lower(trim(v_restaurant_name))
  LIMIT 1;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to modify this menu item';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id', id, 'couponCode', coupon_code))
  INTO v_affected_coupons
  FROM public.coupons
  WHERE menu_item_id = p_item_id
    AND is_deleted = false
    AND coupon_type IN ('item_percent', 'item_fixed');

  IF v_affected_coupons IS NOT NULL AND jsonb_array_length(v_affected_coupons) > 0 AND NOT p_force THEN
    RETURN jsonb_build_object('requiresConfirmation', true, 'affectedCoupons', v_affected_coupons);
  END IF;

  -- saved_menu_items.item_id cascades (030/034), so this is safe even if a
  -- consumer has this item saved.
  DELETE FROM public.menu_items WHERE item_id = p_item_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.delete_menu_item(TEXT, BOOLEAN) TO authenticated;

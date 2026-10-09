-- Owners of chain restaurants cannot change the chain's menu.
--
-- A chain's menu is built once for the whole chain (get-chain-menu) and shared
-- by every branch, but menu_items is keyed by restaurant NAME, so an owner's
-- verify / unverify / delete / out-of-stock on an item acts on that shared row
-- for every branch. For restaurants that match the franchise list those four
-- owner actions are now refused. Admins are unaffected: they use their own
-- admin functions (070), not these.
--
-- Each function below is the latest definition (043 for verify/unverify/delete,
-- 055 for out-of-stock) with ONE addition: after the ownership check, refuse if
-- the restaurant is a franchise chain. Nothing else changes. Safe to re-run.

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

  IF public.is_franchise_chain(v_restaurant_name) THEN
    RAISE EXCEPTION 'This restaurant is part of a chain. Its menu is managed centrally and cannot be changed here.';
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

  IF public.is_franchise_chain(v_restaurant_name) THEN
    RAISE EXCEPTION 'This restaurant is part of a chain. Its menu is managed centrally and cannot be changed here.';
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

  IF public.is_franchise_chain(v_restaurant_name) THEN
    RAISE EXCEPTION 'This restaurant is part of a chain. Its menu is managed centrally and cannot be changed here.';
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

CREATE OR REPLACE FUNCTION public.set_menu_item_out_of_stock(p_item_id TEXT, p_out_of_stock BOOLEAN)
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

  IF public.is_franchise_chain(v_restaurant_name) THEN
    RAISE EXCEPTION 'This restaurant is part of a chain. Its menu is managed centrally and cannot be changed here.';
  END IF;

  UPDATE public.menu_items SET is_out_of_stock = p_out_of_stock WHERE item_id = p_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.set_menu_item_out_of_stock(TEXT, BOOLEAN) TO authenticated;

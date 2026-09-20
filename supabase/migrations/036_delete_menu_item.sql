-- Migration: 036_delete_menu_item
-- Purpose: Targeted single-row delete for one menu item — lets an owner
--          remove one wrong/unwanted item (e.g. a hallucinated AI guess)
--          without going through the full-list "Type Your Menu" replace
--          flow, which can't represent "delete the only item down to zero"
--          at all (both the client and estimate-menu-nutrition's backend
--          refuse to save an empty name list).
--
--          coupons.menu_item_id has no foreign key (by design, see
--          008_coupons_table.sql), so deleting an item a coupon points to
--          wouldn't crash — but it would silently orphan that coupon with no
--          warning. This reuses the same coupon-orphan check already used by
--          replace-restaurant-menu-items, returning a requiresConfirmation
--          shape the client already knows how to handle via
--          confirmAndRetryIfNeeded (same as Refresh/Upload Menu).
-- Date: 2026-09-20

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
  WHERE name = v_restaurant_name
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

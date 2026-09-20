-- Migration: 035_unverify_menu_item
-- Purpose: Companion to verify_menu_item (032) — lets an owner revert a
--          mistaken "this is correct" confirmation back to unconfirmed.
--          Same single-row, ownership-checked update, just flipping the
--          flag the other direction.
-- Date: 2026-09-20

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
  WHERE name = v_restaurant_name
  LIMIT 1;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to modify this menu item';
  END IF;

  UPDATE public.menu_items SET is_verified = FALSE WHERE item_id = p_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.unverify_menu_item(TEXT) TO authenticated;

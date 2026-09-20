-- Migration: 032_verify_menu_item
-- Purpose: Let an owner mark a single existing menu item as verified without
--          going through the full-list "Type Your Menu" replace flow (which
--          regenerates every item's id, even unedited ones, and would orphan
--          any coupon tied to an item that wasn't actually changed). This is
--          a targeted single-row update: flips is_verified only, keeps the
--          item's existing item_id and every other field untouched.
-- Date: 2026-09-16

CREATE OR REPLACE FUNCTION public.verify_menu_item(p_item_id TEXT)
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

  -- Exact match against the item's own stored restaurant_name (not the fuzzy
  -- first-word match used elsewhere for client-supplied search strings) —
  -- this is an authorization check, so it should be as precise as possible.
  SELECT owner_id INTO v_owner_id
  FROM public.restaurants
  WHERE name = v_restaurant_name
  LIMIT 1;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to modify this menu item';
  END IF;

  UPDATE public.menu_items SET is_verified = TRUE WHERE item_id = p_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.verify_menu_item(TEXT) TO authenticated;

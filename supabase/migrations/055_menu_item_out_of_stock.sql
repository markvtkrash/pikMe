-- Lets an owner mark a menu item out of stock without deleting it (so its
-- nutrition data, coupon associations, and verification status aren't
-- lost) — the consumer app excludes out-of-stock items from what it shows,
-- same as it already does for paused/closed restaurants.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_out_of_stock BOOLEAN NOT NULL DEFAULT FALSE;

-- Same ownership-check pattern as verify_menu_item/unverify_menu_item/
-- delete_menu_item (043) — normalized (trim + lowercase) match against
-- restaurants.name, owner-only (no admin path, matching those three).
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

  UPDATE public.menu_items SET is_out_of_stock = p_out_of_stock WHERE item_id = p_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.set_menu_item_out_of_stock(TEXT, BOOLEAN) TO authenticated;

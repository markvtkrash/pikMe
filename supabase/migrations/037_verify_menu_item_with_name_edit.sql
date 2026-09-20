-- Migration: 037_verify_menu_item_with_name_edit
-- Purpose: Verifying an item now happens through an editable confirm popup
--          in the owner app — the owner can fix a slightly-wrong AI-guessed
--          name right there instead of verifying something inaccurate and
--          having to separately go edit it. Extends verify_menu_item (032)
--          with an optional new name; passing none behaves exactly as
--          before (existing callers keep working since it defaults to NULL).
-- Date: 2026-09-20

DROP FUNCTION IF EXISTS public.verify_menu_item(TEXT);

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
  WHERE name = v_restaurant_name
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

-- Migration: 030_menu_items_cascade_saves
-- Purpose: saved_menu_items.item_id referenced menu_items.item_id with no
-- ON DELETE behavior (defaults to NO ACTION), which would make any delete
-- of a stale/replaced menu item fail outright if a consumer had ever saved
-- it. Since a saved item being replaced means the dish it pointed to was
-- fabricated in the first place, cascading the save away when the item is
-- replaced with real data is the correct behavior, not silent data loss of
-- anything real.
-- Date: 2026-09-07

ALTER TABLE public.saved_menu_items
  DROP CONSTRAINT IF EXISTS saved_menu_items_item_id_fkey;

ALTER TABLE public.saved_menu_items
  ADD CONSTRAINT saved_menu_items_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES public.menu_items(item_id) ON DELETE CASCADE;

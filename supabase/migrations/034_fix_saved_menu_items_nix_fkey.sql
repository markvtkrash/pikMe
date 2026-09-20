-- Migration: 034_fix_saved_menu_items_nix_fkey
-- Purpose: Migration 030 assumed the FK on saved_menu_items.item_id was
--          named saved_menu_items_item_id_fkey (Postgres's default
--          auto-generated name) and dropped + recreated it with
--          ON DELETE CASCADE. The actual live constraint was named
--          saved_menu_items_nix_item_id_fkey (a leftover from an earlier
--          Nutritionix-era version of this table), so 030's
--          DROP CONSTRAINT IF EXISTS silently matched nothing — it added a
--          second, correctly-cascading constraint alongside the original,
--          but the original (still NO ACTION) kept enforcing and blocking
--          any menu_items delete for an item a consumer had saved. Exactly
--          the bug 030 was meant to fix, still live under a different name.
-- Date: 2026-09-20

ALTER TABLE public.saved_menu_items
  DROP CONSTRAINT IF EXISTS saved_menu_items_nix_item_id_fkey;

-- Migration 030 already added a correctly-cascading
-- saved_menu_items_item_id_fkey constraint (confirmed live via
-- pg_constraint.confdeltype = 'c') — nothing else to add here, just
-- removing the stale blocker.

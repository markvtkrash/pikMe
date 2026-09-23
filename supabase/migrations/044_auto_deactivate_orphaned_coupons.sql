-- Migration: 044_auto_deactivate_orphaned_coupons
-- Purpose: A coupon whose menu_item_id no longer resolves to a real row
--          (the item was deleted or replaced with a fresh id, e.g. by an AI
--          menu refresh) was still shown as "active" -- is_active and
--          "orphaned" were tracked completely independently, so
--          get_active_coupons_for_restaurant would happily surface an
--          unredeemable coupon to real customers, and the owner's own
--          "active coupons" count stayed wrong until they noticed and
--          manually deactivated it. This trigger deactivates an
--          item-specific coupon the moment its menu item is actually
--          deleted, so "active" always means "genuinely redeemable" instead
--          of needing a separate orphan check layered on top everywhere.
--          coupons.menu_item_id intentionally has no foreign key (see
--          008_coupons_table.sql), so this can't be done via ON DELETE
--          CASCADE/SET NULL -- a trigger is the only way to react to the
--          deletion regardless of which code path caused it.
-- Date: 2026-09-22

CREATE OR REPLACE FUNCTION public.deactivate_orphaned_coupons()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.coupons
  SET is_active = false, updated_at = NOW()
  WHERE menu_item_id = OLD.item_id
    AND coupon_type IN ('item_percent', 'item_fixed')
    AND is_active = true
    AND is_deleted = false;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deactivate_orphaned_coupons ON public.menu_items;

CREATE TRIGGER trg_deactivate_orphaned_coupons
AFTER DELETE ON public.menu_items
FOR EACH ROW
EXECUTE FUNCTION public.deactivate_orphaned_coupons();

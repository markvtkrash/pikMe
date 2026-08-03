-- Cleanup script: Clear ONLY the coupons table (nothing else)
-- Unlike cleanup_menu_coupons.sql (which also wipes menu_items), this
-- touches just public.coupons. No other table has a foreign key into
-- coupons, so this is safe to run on its own.
-- Run this in the Supabase SQL Editor.

BEGIN;

ALTER TABLE public.coupons DISABLE TRIGGER ALL;

TRUNCATE TABLE public.coupons CASCADE;

ALTER TABLE public.coupons ENABLE TRIGGER ALL;

COMMIT;

-- Verify cleanup
SELECT 'coupons' AS table_name, COUNT(*) AS rows FROM public.coupons;

-- ─── Alternative: soft-delete instead of hard wipe ────────────────────────────
-- If you want to keep the rows for audit purposes and just hide them from the
-- app (coupons has an is_deleted/deleted_at pair from migration 012), use this
-- instead of the TRUNCATE above:
--
-- UPDATE public.coupons
-- SET is_deleted = true, deleted_at = NOW()
-- WHERE is_deleted = false;

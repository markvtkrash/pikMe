-- Tests for migration 070. Only the pure piece is scriptable here:
-- admin_menu_item_id (the deterministic id that stops duplicate admin-created
-- items). The other functions call _require_admin(), which needs a logged-in
-- admin (auth.uid() + a user_roles row tied to auth.users), so they are covered
-- by the checklist at the bottom and by the admin app's Jest tests (argument
-- mapping and validation).
--
-- Run in the Supabase SQL editor (or psql -f). Reads and writes nothing.

DO $$
BEGIN
  ASSERT public.admin_menu_item_id('Taco Bell', 'Crunchy Taco')
       = public.admin_menu_item_id('Taco Bell', 'Crunchy Taco'), 'deterministic';
  ASSERT public.admin_menu_item_id('Taco Bell', 'Crunchy Taco')
       = public.admin_menu_item_id('  taco bell ', '  CRUNCHY taco '), 'case and whitespace do not matter';
  ASSERT public.admin_menu_item_id('Taco Bell', 'Crunchy Taco')
       <> public.admin_menu_item_id('Taco Bell', 'Soft Taco'), 'different item -> different id';
  ASSERT public.admin_menu_item_id('Taco Bell', 'Crunchy Taco')
       <> public.admin_menu_item_id('Wendy''s', 'Crunchy Taco'), 'different restaurant -> different id';
  ASSERT public.admin_menu_item_id('Taco Bell', 'Crunchy Taco') LIKE 'admin\_%', 'admin_ prefix';
  ASSERT length(public.admin_menu_item_id('Taco Bell', 'Crunchy Taco')) = length('admin_') + 24, 'fixed length';
  ASSERT public.admin_menu_item_id(NULL, NULL) IS NOT NULL, 'NULL inputs never give NULL';
  RAISE NOTICE 'PASS: admin_menu_item_id';
  RAISE NOTICE 'ALL 070 SCRIPTED TESTS PASSED';
END $$;

-- ── Checklist (run through the admin app as an admin) ────────────────────────
-- Add:    new item with calories + macros -> appears, unverified unless the switch is on.
--         same name again (any case)       -> error "already exists".
--         missing calories / negative value -> blocked in the form and by the database.
-- Update: change calories                  -> saved, nutrition_source becomes owner_provided.
--         change only the name / flags     -> nutrition_source unchanged.
--         rename to another item's name    -> error.
-- Delete: select several, confirm          -> removed; dialog lists coupons deactivated and
--         saved copies removed; "Select all on this page" selects only the visible 50.
-- Access: as a non-admin, each admin_* function raises an admin-only error.

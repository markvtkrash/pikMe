-- Test for migration 108: admin Menu Management works on one location at a time for independent restaurants.
-- The functions need a logged-in admin, which these scripts do not fabricate, so they are checked from their text and
-- access rules. Try the behaviour on the admin Menu Management page (two restaurants with the same name stay apart).
-- Read-only. Requires migrations 070, 100 and 108. Success: no error.
DO $$
DECLARE
  list_def  TEXT := pg_get_functiondef('public.admin_list_restaurants_with_menu_counts()'::regprocedure);
  view_def  TEXT := pg_get_functiondef('public.admin_get_restaurant_menu(text,text)'::regprocedure);
  edit_def  TEXT := pg_get_functiondef('public.admin_get_restaurant_menu_for_edit(text,text)'::regprocedure);
  share_def TEXT := pg_get_functiondef('public.admin_menu_sharing_info(text,text)'::regprocedure);
  save_sig  REGPROCEDURE := to_regprocedure('public.admin_save_menu_item(text,text,text,integer,numeric,numeric,numeric,numeric,integer,numeric,numeric,numeric,boolean,boolean,text)');
  save_def  TEXT;
BEGIN
  ASSERT save_sig IS NOT NULL, 'admin_save_menu_item takes an optional place';
  save_def := pg_get_functiondef(save_sig);

  -- the list: one row per location for independents, one per name for franchises; two new columns last
  ASSERT list_def ILIKE '%place_id text%' AND list_def ILIKE '%is_franchise boolean%', 'the list returns place_id and is_franchise';
  ASSERT position('unverified_items bigint' IN list_def) < position('place_id text' IN list_def), 'the new columns come last';
  ASSERT list_def ILIKE '%NOT ca.fr%' AND list_def ILIKE '%GROUP BY ca.name%', 'independents are not grouped by name; franchises are';
  ASSERT list_def ILIKE '%place_counts%' AND list_def ILIKE '%name_counts%', 'counts come from the place for independents and from the name for franchises';
  ASSERT list_def ILIKE '%_require_admin%', 'the list is admin-only';

  -- reads: a place gives that place's items only; no place gives the shared name-keyed items only
  ASSERT view_def ILIKE '%mi.place_id = p_place_id%' AND view_def ILIKE '%mi.place_id IS NULL%', 'the view reads one place, or the shared menu';
  ASSERT edit_def ILIKE '%mi.place_id = p_place_id%' AND edit_def ILIKE '%mi.place_id IS NULL%', 'the edit read does the same';
  ASSERT view_def ILIKE '%_require_admin%' AND edit_def ILIKE '%_require_admin%', 'both are admin-only';

  -- sharing: none for one place, and the franchise flag
  ASSERT share_def ILIKE '%is_franchise boolean%' AND share_def ILIKE '%is_franchise_chain%', 'the sharing info says whether it is a franchise';
  ASSERT share_def ILIKE '%0::bigint, 0::bigint%', 'one location''s menu is shared with nobody';

  -- saving: place-scoped, never for a franchise
  ASSERT save_def ILIKE '%_require_admin%', 'saving is admin-only';
  ASSERT save_def ILIKE '%place_item_id%', 'a new place item gets an id unique to the place';
  ASSERT save_def ILIKE '%A franchise has one shared menu%', 'a franchise cannot get place items';
  ASSERT save_def ILIKE '%IS NOT DISTINCT FROM v_existing.place_id%', 'the duplicate-name check on update stays within the place';
  ASSERT save_def ILIKE '%valid Google place ID%', 'the place ID is checked';

  -- the old shapes are gone, so nothing can call them by mistake
  ASSERT to_regprocedure('public.admin_get_restaurant_menu(text)') IS NULL, 'the old one-argument view is gone';
  ASSERT to_regprocedure('public.admin_get_restaurant_menu_for_edit(text)') IS NULL, 'the old one-argument edit read is gone';
  ASSERT to_regprocedure('public.admin_menu_sharing_info(text)') IS NULL, 'the old one-argument sharing info is gone';

  -- access
  ASSERT has_function_privilege('authenticated', 'public.admin_list_restaurants_with_menu_counts()', 'EXECUTE'), 'callable when signed in (the admin check is inside)';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_restaurants_with_menu_counts()', 'EXECUTE'), 'not by anon';
  ASSERT NOT has_function_privilege('anon', 'public.admin_get_restaurant_menu(text,text)', 'EXECUTE'), 'anon cannot read';
  ASSERT NOT has_function_privilege('anon', save_sig, 'EXECUTE'), 'anon cannot save';
  ASSERT has_function_privilege('authenticated', save_sig, 'EXECUTE'), 'signed-in admins can save';

  RAISE NOTICE 'ALL 108 TESTS PASSED';
END $$;

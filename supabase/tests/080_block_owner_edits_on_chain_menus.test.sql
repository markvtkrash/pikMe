-- Test for migration 080. The four owner functions identify the caller with
-- auth.uid(), which these scripts don't fabricate, so this checks what can be
-- checked as the database owner: that each function exists, is SECURITY DEFINER,
-- and now contains the chain guard (and still contains its ownership check).
-- Try the behaviour itself in the owner app with a chain restaurant (it should
-- say the menu is managed centrally) and a non-chain one (it should still work).
-- Read-only. Success: no error.
DO $$
DECLARE
  fn TEXT;
  def TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.verify_menu_item(text,text)',
    'public.unverify_menu_item(text)',
    'public.delete_menu_item(text,boolean)',
    'public.set_menu_item_out_of_stock(text,boolean)'
  ] LOOP
    ASSERT to_regprocedure(fn) IS NOT NULL, fn || ' exists';
    def := pg_get_functiondef(to_regprocedure(fn));
    ASSERT def ILIKE '%SECURITY DEFINER%', fn || ' is SECURITY DEFINER';
    ASSERT def LIKE '%is_franchise_chain(v_restaurant_name)%', fn || ' refuses chain restaurants';
    ASSERT def LIKE '%Not authorized to modify this menu item%', fn || ' still checks ownership';
    ASSERT position('is_franchise_chain' IN def) > position('Not authorized' IN def),
      fn || ': the chain check comes after the ownership check';
    ASSERT has_function_privilege('authenticated', to_regprocedure(fn), 'EXECUTE'), fn || ' is callable by signed-in users';
  END LOOP;

  -- The guard relies on the franchise lookup; make sure it behaves as expected.
  ASSERT public.is_franchise_chain('Taco Bell'), 'Taco Bell is a chain';
  ASSERT NOT public.is_franchise_chain('Joe''s Diner'), 'an independent is not a chain';

  RAISE NOTICE 'ALL 080 TESTS PASSED';
END $$;

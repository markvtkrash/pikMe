-- Test for migration 123: confirm many menu items at once. Wiring and access come from the catalog; the behaviour is tried on
-- one real approved restaurant inside a transaction that is rolled back. Needs migration 123. Success: no error.
DO $$
DECLARE
  v_rest  public.restaurants%ROWTYPE;
  v_admin UUID;
  v_p     TEXT;
  v_n     INTEGER;
BEGIN
  ASSERT has_function_privilege('authenticated', 'public.verify_menu_items(text[])', 'EXECUTE'), 'owners can call it';
  ASSERT NOT has_function_privilege('anon', 'public.verify_menu_items(text[])', 'EXECUTE'), 'anon cannot';
  ASSERT has_function_privilege('authenticated', 'public.admin_verify_menu_items(text[])', 'EXECUTE'), 'admins can call it';
  ASSERT NOT has_function_privilege('anon', 'public.admin_verify_menu_items(text[])', 'EXECUTE'), 'anon cannot (admin)';

  SELECT * INTO v_rest FROM public.restaurants r
  WHERE r.status = 'approved' AND r.google_place_id IS NOT NULL AND NOT public.is_franchise_chain(r.name)
  ORDER BY r.created_at LIMIT 1;
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_rest.id IS NULL OR v_admin IS NULL THEN
    RAISE NOTICE 'no approved restaurant or admin to try the behaviour on; wiring checks only';
    RAISE NOTICE 'ALL 123 TESTS PASSED';
    RETURN;
  END IF;
  v_p := v_rest.google_place_id;

  BEGIN
    INSERT INTO public.menu_items (
      item_id, restaurant_name, name, calories, protein_g, total_carbs_g, total_fat_g, saturated_fat_g, sodium_mg,
      is_verified, cached_at, place_id
    ) VALUES
      ('ai_test123a_' || md5(v_p), v_rest.name, 'Test123 A', 100, 0, 0, 0, 0, 0, false, NOW(), v_p),
      ('ai_test123b_' || md5(v_p), v_rest.name, 'Test123 B', 100, 0, 0, 0, 0, 0, false, NOW(), v_p),
      ('manual_test123c_' || md5(v_p), v_rest.name, 'Test123 C', 100, 0, 0, 0, 0, 0, true, NOW(), v_p),
      ('ai_test123x_' || md5(v_p), 'Some Other Test123 Place', 'Test123 X', 100, 0, 0, 0, 0, 0, false, NOW(), 'ChIJ_test123_other_place');

    -- the owner confirms their own unconfirmed items: only the unconfirmed ones change
    PERFORM set_config('request.jwt.claim.sub', v_rest.owner_id::text, true);
    v_n := public.verify_menu_items(ARRAY['ai_test123a_' || md5(v_p), 'ai_test123b_' || md5(v_p), 'manual_test123c_' || md5(v_p)]);
    ASSERT v_n = 2, 'two unconfirmed items were confirmed, got ' || v_n;
    ASSERT (SELECT COUNT(*) FROM public.menu_items WHERE place_id = v_p AND item_id LIKE '%test123%' AND is_verified) = 3, 'all three are confirmed now';
    ASSERT public.verify_menu_items(ARRAY['ai_test123a_' || md5(v_p)]) = 0, 'confirming again changes nothing';
    ASSERT public.verify_menu_items(ARRAY[]::TEXT[]) = 0, 'an empty list changes nothing';

    -- an item that is not theirs: nothing at all is changed
    BEGIN
      PERFORM public.verify_menu_items(ARRAY['ai_test123a_' || md5(v_p), 'ai_test123x_' || md5(v_p)]);
      RAISE EXCEPTION 'someone else''s item was accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'someone else''s item was accepted' THEN RAISE; END IF;
    END;
    ASSERT NOT (SELECT is_verified FROM public.menu_items WHERE item_id = 'ai_test123x_' || md5(v_p)), 'the other restaurant''s item is untouched';

    -- another signed-in user cannot confirm these
    UPDATE public.menu_items SET is_verified = false WHERE place_id = v_p AND item_id LIKE '%test123a%';
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    BEGIN
      PERFORM public.verify_menu_items(ARRAY['ai_test123a_' || md5(v_p)]);
      RAISE EXCEPTION 'another user was allowed';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'another user was allowed' THEN RAISE; END IF;
    END;

    -- an admin confirms any restaurant's items, but a non-admin cannot use the admin function
    BEGIN
      PERFORM public.admin_verify_menu_items(ARRAY['ai_test123a_' || md5(v_p)]);
      RAISE EXCEPTION 'a non-admin was allowed';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'a non-admin was allowed' THEN RAISE; END IF;
    END;
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    v_n := public.admin_verify_menu_items(ARRAY['ai_test123a_' || md5(v_p), 'ai_test123x_' || md5(v_p)]);
    ASSERT v_n = 2, 'the admin confirmed both, got ' || v_n;

    RAISE EXCEPTION 'rollback_test_123';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_123' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 123 TESTS PASSED';
END $$;

-- Test for migration 132: cleaning up owner logins that have no restaurant. Wiring and access from the catalog; the rules are tried inside a
-- transaction that is rolled back. Needs migrations 042 and 132. Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_id    UUID := '00000000-0000-0000-0000-0000000013a1';
  v_other UUID := '00000000-0000-0000-0000-0000000013a2';
  v_row   RECORD;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'restaurant_owners' AND column_name = 'deactivated_at'), 'the column exists';
  ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'ownerDeleteWaitDays'), 'the wait setting exists';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_removable_owners()', 'EXECUTE'), 'anon cannot list';
  ASSERT NOT has_function_privilege('authenticated', 'public.owner_delete_check(uuid[])', 'EXECUTE'), 'the delete check is server only';
  ASSERT has_function_privilege('service_role', 'public.owner_delete_check(uuid[])', 'EXECUTE'), 'the server can run it';
  ASSERT NOT has_function_privilege('authenticated', 'public._owner_removal_state()', 'EXECUTE'), 'the rules are not exposed directly';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user to try the behaviour with; wiring checks only';
    RAISE NOTICE 'ALL 132 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    -- two fake owners: an auth user is needed because restaurant_owners.id references it
    INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
      (v_id, 'cleanup-13a1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
      (v_other, 'cleanup-13a2@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.restaurant_owners (id, business_name, email, is_active) VALUES
      (v_id, 'Cleanup Test A', 'cleanup-13a1@example.com', TRUE),
      (v_other, 'Cleanup Test B', 'cleanup-13a2@example.com', TRUE);

    -- active: flagged, but must be deactivated first
    SELECT * INTO v_row FROM public.admin_list_removable_owners() WHERE owner_id = v_id;
    ASSERT FOUND AND NOT v_row.can_delete AND v_row.reason = 'Deactivate it first', 'an active owner must be deactivated first';

    -- deactivate both in one step; a repeat changes nothing
    ASSERT public.admin_deactivate_owners(ARRAY[v_id, v_other]) = 2, 'both are deactivated';
    ASSERT public.admin_deactivate_owners(ARRAY[v_id, v_other]) = 0, 'a repeat changes nothing';
    ASSERT (SELECT deactivated_at FROM public.restaurant_owners WHERE id = v_id) IS NOT NULL, 'the date is recorded';

    -- just deactivated: wait period not over
    SELECT * INTO v_row FROM public.admin_list_removable_owners() WHERE owner_id = v_id;
    ASSERT NOT v_row.can_delete AND v_row.days_left > 0 AND v_row.reason LIKE 'Can be deleted in %', 'it must wait';

    -- after the wait: deletable. (An owner ticket must belong to a restaurant and is removed with it, so an owner with no restaurant
    -- cannot hold a ticket; the open-ticket rule is only a safety net and cannot be reached from here.)
    UPDATE public.restaurant_owners SET deactivated_at = NOW() - INTERVAL '40 days' WHERE id IN (v_id, v_other);
    SELECT * INTO v_row FROM public.admin_list_removable_owners() WHERE owner_id = v_id;
    ASSERT v_row.can_delete AND v_row.reason IS NULL AND v_row.open_tickets = 0, 'it can be deleted after the wait';
    SELECT * INTO v_row FROM public.admin_list_removable_owners() WHERE owner_id = v_other;
    ASSERT v_row.can_delete, 'the second one too';

    -- the server check agrees, and refuses an owner that now has a restaurant
    ASSERT (SELECT can_delete FROM public.owner_delete_check(ARRAY[v_id]) LIMIT 1), 'the server check allows it';
    ASSERT (SELECT can_delete FROM public.owner_delete_check(ARRAY[v_other]) LIMIT 1), 'the server check allows the second one';
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, status)
    VALUES (v_id, 'ZZtest_cleanup_132', 'Now Has One', '1 Main St', 'pending');
    ASSERT NOT EXISTS (SELECT 1 FROM public.admin_list_removable_owners() WHERE owner_id = v_id), 'an owner with a restaurant is not listed';
    ASSERT NOT (SELECT can_delete FROM public.owner_delete_check(ARRAY[v_id]) LIMIT 1), 'and cannot be deleted';
    ASSERT NOT (SELECT can_delete FROM public.owner_delete_check(ARRAY['00000000-0000-0000-0000-0000000013ff'::uuid]) LIMIT 1), 'an unknown id cannot be deleted';

    -- reactivating clears the date
    PERFORM public.admin_set_owner_active(v_other, TRUE);
    ASSERT (SELECT deactivated_at FROM public.restaurant_owners WHERE id = v_other) IS NULL, 'reactivating clears the date';

    -- a non-admin is refused
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    BEGIN
      PERFORM public.admin_list_removable_owners();
      RAISE EXCEPTION 'a non-admin was allowed';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a non-admin was allowed' THEN RAISE; END IF; END;

    RAISE EXCEPTION 'rollback_test_132';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_132' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 132 TESTS PASSED';
END $$;

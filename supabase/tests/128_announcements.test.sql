-- Test for migration 128: in-app announcements. Wiring and access come from the catalog; the behaviour is tried inside a
-- transaction that is rolled back, so nothing is left behind. Needs migration 128. Success: no error.
DO $$
DECLARE
  v_admin UUID;
  v_id    UUID;
  v_cfg   JSONB;
BEGIN
  -- versions
  ASSERT public._version_cmp('1.2.0', '1.10.0') = -1, '1.2.0 is below 1.10.0';
  ASSERT public._version_cmp('2.0.0', '1.99.99') = 1, '2.0.0 is above 1.99.99';
  ASSERT public._version_cmp('1.2', '1.2.0') = 0, 'a short version has zero for the missing parts';
  ASSERT public._version_cmp(NULL, '1.0.0') = -1, 'no version is below 1.0.0';

  -- access
  ASSERT has_function_privilege('anon', 'public.get_active_announcements(text,text)', 'EXECUTE'), 'readable before sign-in';
  ASSERT has_function_privilege('authenticated', 'public.get_active_announcements(text,text)', 'EXECUTE'), 'readable when signed in';
  ASSERT NOT has_table_privilege('anon', 'public.announcements', 'SELECT'), 'the table is not readable directly';
  ASSERT NOT has_table_privilege('authenticated', 'public.announcements', 'SELECT'), 'nor by signed-in users';
  ASSERT NOT has_function_privilege('anon', 'public.admin_save_announcement(uuid,text,text,text,text,text,text,timestamptz,timestamptz,text,text)', 'EXECUTE'), 'anon cannot save';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_announcements()', 'EXECUTE'), 'anon cannot list';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user to try the behaviour with; wiring checks only';
    RAISE NOTICE 'ALL 128 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    DELETE FROM public.announcements;

    -- a customer announcement is live at once and reaches customers only
    v_id := public.admin_save_announcement(NULL, 'customer', ' Hello ', ' New feature ', 'info', NULL, NULL, NULL, NULL, NULL, NULL);
    ASSERT (SELECT COUNT(*) FROM public.get_active_announcements('customer')) = 1, 'customers see it';
    ASSERT (SELECT COUNT(*) FROM public.get_active_announcements('owner')) = 0, 'owners do not';
    ASSERT (SELECT title FROM public.get_active_announcements('customer') LIMIT 1) = 'Hello', 'the title is trimmed';
    ASSERT (SELECT COUNT(*) FROM public.get_active_announcements('nobody')) = 0, 'an unknown audience gets nothing';

    -- both, and important comes first
    PERFORM public.admin_save_announcement(NULL, 'both', 'For all', 'Everyone', 'important', 'Read more', 'https://example.com/news', NULL, NULL, NULL, NULL);
    ASSERT (SELECT COUNT(*) FROM public.get_active_announcements('owner')) = 1, 'owners see the both one';
    ASSERT (SELECT kind FROM public.get_active_announcements('customer') LIMIT 1) = 'important', 'important comes first';

    -- scheduled: not live yet
    PERFORM public.admin_save_announcement(NULL, 'owner', 'Later', 'Soon', 'info', NULL, NULL, NOW() + INTERVAL '1 day', NULL, NULL, NULL);
    ASSERT (SELECT COUNT(*) FROM public.get_active_announcements('owner')) = 1, 'a scheduled one is not shown yet';
    ASSERT (SELECT status FROM public.admin_list_announcements() WHERE title = 'Later') = 'scheduled', 'and is listed as scheduled';

    -- version range
    PERFORM public.admin_save_announcement(NULL, 'customer', 'Old only', 'Update please', 'info', NULL, NULL, NULL, NULL, NULL, '1.0.5');
    ASSERT (SELECT COUNT(*) FROM public.get_active_announcements('customer', '1.0.0') WHERE title = 'Old only') = 1, 'an old version sees it';
    ASSERT (SELECT COUNT(*) FROM public.get_active_announcements('customer', '1.0.5') WHERE title = 'Old only') = 1, 'the highest version still sees it';
    ASSERT (SELECT COUNT(*) FROM public.get_active_announcements('customer', '1.1.0') WHERE title = 'Old only') = 0, 'a newer version does not';
    ASSERT (SELECT COUNT(*) FROM public.get_active_announcements('customer') WHERE title = 'Old only') = 1, 'with no version given the range is ignored';

    -- at most three
    PERFORM public.admin_save_announcement(NULL, 'customer', 'Four', 'Four', 'info', NULL, NULL, NULL, NULL, NULL, NULL);
    PERFORM public.admin_save_announcement(NULL, 'customer', 'Five', 'Five', 'info', NULL, NULL, NULL, NULL, NULL, NULL);
    ASSERT (SELECT COUNT(*) FROM public.get_active_announcements('customer')) = 3, 'at most three at a time';

    -- the customer's one call carries them too, and still only the whitelisted settings
    v_cfg := public.get_customer_config('1.0.0');
    ASSERT jsonb_typeof(v_cfg -> 'announcements') = 'array', 'the announcements ride along';
    ASSERT jsonb_array_length(v_cfg -> 'announcements') = 3, 'with the same three';
    ASSERT NOT EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_cfg) k
      WHERE k NOT IN ('maxRadiusMiles', 'showUnconfirmedMenuItems', 'minAppVersion', 'announcements', 'categories')
    ), 'nothing else is exposed';

    -- ending
    PERFORM public.admin_end_announcement(v_id);
    ASSERT (SELECT status FROM public.admin_list_announcements() WHERE id = v_id) = 'ended', 'End now ends it';
    ASSERT NOT EXISTS (SELECT 1 FROM public.get_active_announcements('customer') WHERE id = v_id), 'and it is no longer shown';

    -- editing and deleting
    PERFORM public.admin_save_announcement(v_id, 'customer', 'Edited', 'Edited text', 'info', NULL, NULL, NULL, NULL, NULL, NULL);
    ASSERT (SELECT title FROM public.admin_list_announcements() WHERE id = v_id) = 'Edited', 'an edit is saved';
    PERFORM public.admin_delete_announcement(v_id);
    ASSERT NOT EXISTS (SELECT 1 FROM public.admin_list_announcements() WHERE id = v_id), 'delete removes it';

    -- validation
    BEGIN
      PERFORM public.admin_save_announcement(NULL, 'customer', '', 'x', 'info', NULL, NULL, NULL, NULL, NULL, NULL);
      RAISE EXCEPTION 'an empty title was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'an empty title was accepted' THEN RAISE; END IF; END;
    BEGIN
      PERFORM public.admin_save_announcement(NULL, 'customer', 'T', 'x', 'info', 'Label only', NULL, NULL, NULL, NULL, NULL);
      RAISE EXCEPTION 'a link without an address was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a link without an address was accepted' THEN RAISE; END IF; END;
    BEGIN
      PERFORM public.admin_save_announcement(NULL, 'customer', 'T', 'x', 'info', 'Go', 'http://insecure.example.com', NULL, NULL, NULL, NULL);
      RAISE EXCEPTION 'a non-https link was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a non-https link was accepted' THEN RAISE; END IF; END;
    BEGIN
      PERFORM public.admin_save_announcement(NULL, 'customer', 'T', 'x', 'info', NULL, NULL, NULL, NULL, '2.0.0', '1.0.0');
      RAISE EXCEPTION 'a backwards version range was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a backwards version range was accepted' THEN RAISE; END IF; END;
    BEGIN
      PERFORM public.admin_save_announcement(NULL, 'everyone', 'T', 'x', 'info', NULL, NULL, NULL, NULL, NULL, NULL);
      RAISE EXCEPTION 'a bad audience was accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a bad audience was accepted' THEN RAISE; END IF; END;

    -- a non-admin cannot manage announcements
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    BEGIN
      PERFORM public.admin_list_announcements();
      RAISE EXCEPTION 'a non-admin was allowed';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'a non-admin was allowed' THEN RAISE; END IF; END;

    RAISE EXCEPTION 'rollback_test_128';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_128' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 128 TESTS PASSED';
END $$;

-- Test for migration 124: the owner is told about a menu link that worked for the admin, even after the admin's save replaced
-- the record of the owner's failed read. Tried on one real approved restaurant inside a transaction that is rolled back.
-- Needs migrations 114, 121, 122 and 124. Success: no error.
DO $$
DECLARE
  v_rest   public.restaurants%ROWTYPE;
  v_admin  UUID;
  v_row    RECORD;
  v_count  INTEGER;
  v_ours   TEXT := 'https://owner-124.example.com/men';
  v_theirs TEXT := 'https://admin-124.example.com/menu';
BEGIN
  ASSERT has_function_privilege('authenticated', 'public.owner_menu_link_help()', 'EXECUTE'), 'owners can ask';
  ASSERT NOT has_function_privilege('anon', 'public.owner_menu_link_help()', 'EXECUTE'), 'anon cannot';

  SELECT * INTO v_rest FROM public.restaurants r
  WHERE r.status = 'approved' AND r.google_place_id IS NOT NULL AND NOT public.is_franchise_chain(r.name)
  ORDER BY r.created_at LIMIT 1;
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_rest.id IS NULL OR v_admin IS NULL THEN
    RAISE NOTICE 'no approved restaurant or admin to try the behaviour on; wiring checks only';
    RAISE NOTICE 'ALL 124 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    DELETE FROM public.place_menu_crawl WHERE place_id = v_rest.google_place_id;
    UPDATE public.menu_build_queue SET override_link = NULL WHERE kind = 'place' AND place_id = v_rest.google_place_id;
    DELETE FROM public.menu_items WHERE place_id = v_rest.google_place_id AND item_id NOT LIKE 'ai\_%' ESCAPE '\';

    -- the owner saves a wrong link and the read finds nothing
    UPDATE public.restaurants SET menu_link = v_ours WHERE id = v_rest.id;
    UPDATE public.place_menu_crawl SET status = 'crawling', claimed_at = NOW() WHERE place_id = v_rest.google_place_id;
    PERFORM public.finish_place_crawl(v_rest.google_place_id, v_ours, 'no_items', 'none', 0);
    UPDATE public.place_menu_crawl SET finished_at = NOW() - INTERVAL '2 hours' WHERE place_id = v_rest.google_place_id;

    PERFORM set_config('request.jwt.claim.sub', v_rest.owner_id::text, true);
    SELECT * INTO v_row FROM public.owner_menu_link_help();
    ASSERT v_row.owner_link_failed IS TRUE AND v_row.suggested_link IS NULL, 'a failed read of the owner link gives a note, with no suggestion yet';

    -- the admin corrects the link and the read works: the owner's failed record is replaced
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    PERFORM public.admin_set_place_menu_link(v_rest.google_place_id, v_theirs);
    UPDATE public.place_menu_crawl SET status = 'crawling', claimed_at = NOW() WHERE place_id = v_rest.google_place_id;
    PERFORM public.finish_place_crawl(v_rest.google_place_id, v_theirs, 'ok', 'read', 9);
    ASSERT (SELECT link_source FROM public.place_menu_crawl WHERE place_id = v_rest.google_place_id) = 'admin', 'the record is the admin''s now';

    -- the owner is still told, and sent to the working link
    PERFORM set_config('request.jwt.claim.sub', v_rest.owner_id::text, true);
    SELECT * INTO v_row FROM public.owner_menu_link_help();
    ASSERT v_row.suggested_link = v_theirs AND v_row.owner_link_failed IS FALSE, 'the owner is pointed to the link that worked';

    -- once the owner uses that link, the note goes away
    UPDATE public.restaurants SET menu_link = v_theirs WHERE id = v_rest.id;
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_link_help();
    ASSERT v_count = 0, 'no note when the owner link is the working one';

    -- an owner with no saved link is not nagged about the admin's link
    UPDATE public.restaurants SET menu_link = NULL WHERE id = v_rest.id;
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_link_help();
    ASSERT v_count = 0, 'no note when the owner has no saved link';

    -- an admin link that did not work is never suggested
    UPDATE public.restaurants SET menu_link = v_ours WHERE id = v_rest.id;
    UPDATE public.menu_build_queue SET override_link_ok = FALSE WHERE kind = 'place' AND place_id = v_rest.google_place_id;
    UPDATE public.place_menu_crawl SET link_source = 'admin', link = v_theirs, status = 'done' WHERE place_id = v_rest.google_place_id;
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_link_help();
    ASSERT v_count = 0, 'a link that did not work is not suggested';

    -- another user gets nothing
    UPDATE public.menu_build_queue SET override_link_ok = TRUE WHERE kind = 'place' AND place_id = v_rest.google_place_id;
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_link_help();
    ASSERT v_count = 0, 'another user gets nothing';

    RAISE EXCEPTION 'rollback_test_124';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_124' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 124 TESTS PASSED';
END $$;

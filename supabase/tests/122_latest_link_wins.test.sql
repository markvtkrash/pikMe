-- Test for migration 122: the latest menu link save wins, and the owner is helped when their link fails. Wiring and access
-- come from the catalog; the behaviour is tried on one real approved restaurant inside a transaction that is rolled back.
-- Needs migrations 114, 117, 118, 121 and 122. Success: no error.
DO $$
DECLARE
  v_rest   public.restaurants%ROWTYPE;
  v_admin  UUID;
  v_row    RECORD;
  v_count  INTEGER;
  v_text   TEXT;
  v_ours   TEXT := 'https://owner-122.example.com/menu';
  v_theirs TEXT := 'https://admin-122.example.com/menu';
BEGIN
  ASSERT has_function_privilege('authenticated', 'public.owner_menu_link_help()', 'EXECUTE'), 'owners can ask';
  ASSERT NOT has_function_privilege('anon', 'public.owner_menu_link_help()', 'EXECUTE'), 'anon cannot';
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'menu_build_queue' AND column_name = 'override_link_ok'
  ), 'the did-it-work column exists';

  SELECT * INTO v_rest FROM public.restaurants r
  WHERE r.status = 'approved' AND r.google_place_id IS NOT NULL AND NOT public.is_franchise_chain(r.name)
  ORDER BY r.created_at LIMIT 1;
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  IF v_rest.id IS NULL OR v_admin IS NULL THEN
    RAISE NOTICE 'no approved restaurant or admin to try the behaviour on; wiring checks only';
    RAISE NOTICE 'ALL 122 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    DELETE FROM public.place_menu_crawl WHERE place_id = v_rest.google_place_id;
    UPDATE public.menu_build_queue SET override_link = NULL WHERE kind = 'place' AND place_id = v_rest.google_place_id;
    DELETE FROM public.menu_items WHERE place_id = v_rest.google_place_id AND item_id NOT LIKE 'ai\_%' ESCAPE '\';

    -- the admin sets a link
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    PERFORM public.admin_set_place_menu_link(v_rest.google_place_id, v_theirs);
    SELECT * INTO v_row FROM public.menu_build_queue WHERE kind = 'place' AND place_id = v_rest.google_place_id;
    ASSERT v_row.override_link = v_theirs AND v_row.override_link_ok IS NULL, 'the admin link starts as not read yet';

    -- a read of the admin link that adds dishes marks it as working; one that finds nothing marks it as not working
    UPDATE public.place_menu_crawl SET status = 'crawling', claimed_at = NOW() WHERE place_id = v_rest.google_place_id;
    PERFORM public.finish_place_crawl(v_rest.google_place_id, v_theirs, 'ok', 'read', 5);
    ASSERT (SELECT override_link_ok FROM public.menu_build_queue WHERE kind = 'place' AND place_id = v_rest.google_place_id) IS TRUE,
      'a read that added dishes marks the admin link as working';
    UPDATE public.place_menu_crawl SET status = 'crawling', claimed_at = NOW() WHERE place_id = v_rest.google_place_id;
    PERFORM public.finish_place_crawl(v_rest.google_place_id, v_theirs, 'no_items', 'none', 0);
    ASSERT (SELECT override_link_ok FROM public.menu_build_queue WHERE kind = 'place' AND place_id = v_rest.google_place_id) IS FALSE,
      'a read that found nothing marks it as not working';
    PERFORM public.admin_set_place_menu_link(v_rest.google_place_id, v_theirs);
    ASSERT (SELECT override_link_ok FROM public.menu_build_queue WHERE kind = 'place' AND place_id = v_rest.google_place_id) IS NULL,
      'saving the admin link again resets it';

    -- the latest save wins: the owner saves their link while the admin link is set
    UPDATE public.restaurants SET menu_link = v_ours WHERE id = v_rest.id;       -- (the trigger queues the owner link)
    SELECT * INTO v_row FROM public.place_menu_crawl WHERE place_id = v_rest.google_place_id;
    ASSERT v_row.link = v_ours AND v_row.link_source = 'owner' AND v_row.status = 'pending', 'the owner link is queued even with an admin link set';
    ASSERT (SELECT override_link FROM public.menu_build_queue WHERE kind = 'place' AND place_id = v_rest.google_place_id) = v_theirs,
      'the admin link is kept as a suggestion';
    SELECT * INTO v_row FROM public.admin_get_place_menu_link(v_rest.google_place_id);
    ASSERT v_row.source = 'owner' AND v_row.admin_link = v_theirs, 'the admin sees the owner link in force and their own link';

    -- the admin saving again takes over again
    PERFORM public.admin_set_place_menu_link(v_rest.google_place_id, v_theirs);
    ASSERT (SELECT link_source FROM public.place_menu_crawl WHERE place_id = v_rest.google_place_id) = 'admin', 'the admin save is the latest';
    UPDATE public.restaurants SET menu_link = v_ours WHERE id = v_rest.id;

    -- the owner's help: nothing while their link has not failed
    PERFORM set_config('request.jwt.claim.sub', v_rest.owner_id::text, true);
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_link_help();
    ASSERT v_count = 0, 'no help while the link is waiting to be read';

    -- their link read nothing; the admin link has not been read yet: a row with no suggestion
    UPDATE public.place_menu_crawl SET status = 'crawling', claimed_at = NOW() WHERE place_id = v_rest.google_place_id;
    PERFORM public.finish_place_crawl(v_rest.google_place_id, v_ours, 'no_items', 'none', 0);
    UPDATE public.place_menu_crawl SET finished_at = NOW() - INTERVAL '1 hour' WHERE place_id = v_rest.google_place_id;
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_link_help();
    ASSERT v_count = 1, 'a failed read of the owner link gives the owner a note';
    SELECT suggested_link INTO v_text FROM public.owner_menu_link_help();
    ASSERT v_text IS NULL, 'no suggestion while the admin link has not been shown to work';

    -- the admin link did not work: still no suggestion
    UPDATE public.menu_build_queue SET override_link_ok = FALSE WHERE kind = 'place' AND place_id = v_rest.google_place_id;
    SELECT suggested_link INTO v_text FROM public.owner_menu_link_help();
    ASSERT v_text IS NULL, 'no suggestion when the admin link did not work';

    -- the admin link worked: it is suggested
    UPDATE public.menu_build_queue SET override_link_ok = TRUE WHERE kind = 'place' AND place_id = v_rest.google_place_id;
    SELECT suggested_link INTO v_text FROM public.owner_menu_link_help();
    ASSERT v_text = v_theirs, 'a working admin link is suggested';

    -- the same link as the owner's is not a suggestion
    UPDATE public.menu_build_queue SET override_link_ok = TRUE WHERE kind = 'place' AND place_id = v_rest.google_place_id;
    -- (override_link equal to the owner's: the reset trigger clears the flag, so set it after)
    UPDATE public.menu_build_queue SET override_link = v_ours WHERE kind = 'place' AND place_id = v_rest.google_place_id;
    UPDATE public.menu_build_queue SET override_link_ok = TRUE WHERE kind = 'place' AND place_id = v_rest.google_place_id;
    SELECT suggested_link INTO v_text FROM public.owner_menu_link_help();
    ASSERT v_text IS NULL, 'the owner link itself is not suggested back';

    -- another owner sees nothing
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    SELECT COUNT(*) INTO v_count FROM public.owner_menu_link_help();
    ASSERT v_count = 0, 'another user gets nothing';

    -- a link found online still never replaces an owner or admin link
    ASSERT public.request_place_crawl(v_rest.google_place_id, v_rest.name, 'https://found-122.example.com', 'google') = 'owner_or_admin_link',
      'a found link does not replace the owner or admin link';

    RAISE EXCEPTION 'rollback_test_122';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_122' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 122 TESTS PASSED';
END $$;

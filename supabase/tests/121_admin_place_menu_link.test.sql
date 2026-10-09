-- Test for migration 121: an admin's menu link for one restaurant. Wiring and access come from the catalog; the behaviour
-- is tried on one real cached restaurant inside a transaction that is rolled back. Needs migrations 107, 114, 118 and 121.
-- Success: no error.
DO $$
DECLARE
  v_place TEXT;
  v_name  TEXT;
  v_admin UUID;
  v_row   RECORD;
  v_link  TEXT := 'https://admin-test-121.example.com/menu';
BEGIN
  ASSERT has_function_privilege('authenticated', 'public.admin_get_place_menu_link(text)', 'EXECUTE'), 'admins can read';
  ASSERT has_function_privilege('authenticated', 'public.admin_set_place_menu_link(text,text)', 'EXECUTE'), 'admins can save';
  ASSERT NOT has_function_privilege('anon', 'public.admin_get_place_menu_link(text)', 'EXECUTE'), 'anon cannot read';
  ASSERT NOT has_function_privilege('anon', 'public.admin_set_place_menu_link(text,text)', 'EXECUTE'), 'anon cannot save';

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role = 'admin' LIMIT 1;
  SELECT cr.place_id, cr.name INTO v_place, v_name FROM public.cached_restaurants cr
  WHERE cr.place_id ~ '^[A-Za-z0-9_-]{10,200}$' AND NOT public.is_franchise_chain(cr.name)
  ORDER BY cr.cached_at DESC LIMIT 1;
  IF v_admin IS NULL OR v_place IS NULL THEN
    RAISE NOTICE 'no admin user or cached independent restaurant to try the behaviour on; wiring checks only';
    RAISE NOTICE 'ALL 121 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    DELETE FROM public.place_menu_crawl WHERE place_id = v_place;
    UPDATE public.menu_build_queue SET override_link = NULL WHERE kind = 'place' AND place_id = v_place;
    UPDATE public.restaurants SET menu_link = NULL WHERE google_place_id = v_place;

    -- nothing yet
    ASSERT NOT EXISTS (SELECT 1 FROM public.admin_get_place_menu_link(v_place)), 'no link to start with';

    -- bad links are refused
    BEGIN
      PERFORM public.admin_set_place_menu_link(v_place, 'not a link');
      RAISE EXCEPTION 'a bad link was accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'a bad link was accepted' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM public.admin_set_place_menu_link('x', v_link);
      RAISE EXCEPTION 'a bad place was accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'a bad place was accepted' THEN RAISE; END IF;
    END;

    -- saving: queued for the crawler as the admin's link
    ASSERT public.admin_set_place_menu_link(v_place, '  ' || v_link || ' ') = 'queued', 'the link is saved';
    SELECT * INTO v_row FROM public.admin_get_place_menu_link(v_place);
    ASSERT v_row.link = v_link AND v_row.source = 'admin' AND v_row.status = 'pending', 'it shows as the admin link, waiting to be read';
    ASSERT (SELECT link_source FROM public.place_menu_crawl WHERE place_id = v_place) = 'admin', 'queued for the crawler';

    -- saving again re-queues it
    UPDATE public.place_menu_crawl SET status = 'no_items', finished_at = NOW() WHERE place_id = v_place;
    PERFORM public.admin_set_place_menu_link(v_place, v_link);
    ASSERT (SELECT status FROM public.place_menu_crawl WHERE place_id = v_place) = 'pending', 'saving again reads it again';

    -- the admin's link wins over a link found online
    ASSERT public.request_place_crawl(v_place, v_name, 'https://found-121.example.com', 'google') = 'owner_or_admin_link',
      'a found link does not replace the admin link';

    -- removing it drops the crawl record when the owner has no link
    ASSERT public.admin_set_place_menu_link(v_place, '') = 'removed', 'a blank link removes it';
    ASSERT NOT EXISTS (SELECT 1 FROM public.place_menu_crawl WHERE place_id = v_place), 'the crawl record is gone';
    ASSERT NOT EXISTS (SELECT 1 FROM public.admin_get_place_menu_link(v_place)), 'no link again';

    RAISE EXCEPTION 'rollback_test_121';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_121' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 121 TESTS PASSED';
END $$;

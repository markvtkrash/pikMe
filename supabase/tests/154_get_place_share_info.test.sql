-- Test for migration 154: get_place_share_info -- the public lookup behind mkrash-web's /r/[placeId] share page.
-- Tried inside a transaction that is rolled back. Needs migrations 007, 018, 129, 139. Success: no error.
DO $$
DECLARE
  v_owner UUID;
  v_row   RECORD;
  v_cached  CONSTANT TEXT := 'ChIJshare154cachedaaaa';
  v_claimed CONSTANT TEXT := 'ChIJshare154claimedbbb';
  v_closed  CONSTANT TEXT := 'ChIJshare154closedcccc';
  v_unknown CONSTANT TEXT := 'ChIJshare154unknownzzz';
BEGIN
  ASSERT has_function_privilege('anon', 'public.get_place_share_info(text)', 'EXECUTE'), 'anon can look up a place to share';
  ASSERT has_function_privilege('authenticated', 'public.get_place_share_info(text)', 'EXECUTE'), 'a signed-in customer can too';

  -- a blank or unknown place_id returns nothing -- never an error, never a Google call
  ASSERT (SELECT COUNT(*) FROM public.get_place_share_info(v_unknown)) = 0, 'an unknown place_id returns no rows';
  ASSERT (SELECT COUNT(*) FROM public.get_place_share_info(NULL)) = 0, 'a null place_id returns no rows';
  ASSERT (SELECT COUNT(*) FROM public.get_place_share_info('')) = 0, 'an empty place_id returns no rows';

  BEGIN
    -- cached-only: no claimed row at all, the Google-sourced cache answers
    INSERT INTO public.cached_restaurants (place_id, name, address, cuisine_types)
      VALUES (v_cached, 'Cached Noodle House', '1 Cache St, Testville, TX 70001, USA', ARRAY['asian']);
    SELECT * INTO v_row FROM public.get_place_share_info(v_cached);
    ASSERT v_row.name = 'Cached Noodle House' AND v_row.address = '1 Cache St, Testville, TX 70001, USA' AND v_row.cuisine_types = ARRAY['asian'],
      'a cached-only place returns the cache row';

    SELECT id INTO v_owner FROM public.restaurant_owners LIMIT 1;
    IF v_owner IS NULL THEN
      RAISE NOTICE 'no restaurant owner to test the claimed-restaurant path with; the cache-only and unknown-place paths were checked';
    ELSE
      -- claimed + listed: the restaurant's own (owner-set) info wins over a same-place_id cache row
      INSERT INTO public.restaurants (owner_id, google_place_id, name, address, cuisines, status)
        VALUES (v_owner, v_claimed, 'Claimed Taco Spot', '2 Owner Ave, Testville, TX 70002, USA', ARRAY['mexican'], 'approved');
      INSERT INTO public.cached_restaurants (place_id, name, address, cuisine_types)
        VALUES (v_claimed, 'Stale Cached Name', '2 Owner Ave, Testville, TX 70002, USA', ARRAY['unknown']);
      SELECT * INTO v_row FROM public.get_place_share_info(v_claimed);
      ASSERT v_row.name = 'Claimed Taco Spot' AND v_row.cuisine_types = ARRAY['mexican'],
        'a claimed, listed place returns its own info, not the cache';

      -- claimed but closed: must not leak through just because the row exists -- falls back to the cache
      INSERT INTO public.restaurants (owner_id, google_place_id, name, address, cuisines, status)
        VALUES (v_owner, v_closed, 'Closed Burger Joint', '3 Shut Rd, Testville, TX 70003, USA', ARRAY['american'], 'closed');
      ASSERT (SELECT COUNT(*) FROM public.get_place_share_info(v_closed)) = 0,
        'a claimed-but-closed place with no cache row returns nothing';
      INSERT INTO public.cached_restaurants (place_id, name, address, cuisine_types)
        VALUES (v_closed, 'Closed Burger Joint (cached)', '3 Shut Rd, Testville, TX 70003, USA', ARRAY['american']);
      SELECT * INTO v_row FROM public.get_place_share_info(v_closed);
      ASSERT v_row.name = 'Closed Burger Joint (cached)', 'a claimed-but-closed place falls back to its cache row instead';
    END IF;

    RAISE EXCEPTION 'rollback_test_154';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_154' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 154 TESTS PASSED';
END $$;

-- Test for migration 082: find_chain_place_id also finds the place ID of a
-- CLAIMED restaurant (for example one an admin created with Create Owner), and
-- still prefers the most recently seen match across both sources.
-- Self-contained, inside a transaction, rolled back. Needs at least one existing
-- restaurant owner to attach a test restaurant to; without one the claimed-store
-- checks are skipped with a notice. Success: no error.
BEGIN;

DO $$
DECLARE
  v_chain UUID;
  v_owner UUID;
BEGIN
  INSERT INTO public.franchise_chains (name, aliases) VALUES ('ZZ Claimed Place Chain', ARRAY[]::TEXT[])
  RETURNING id INTO v_chain;

  -- Same behaviour as 081 for a cached-only chain.
  INSERT INTO public.cached_restaurants (place_id, name, cached_at)
  VALUES ('ChIJzzcached00000000', 'ZZ Claimed Place Chain', NOW() - INTERVAL '3 days');
  ASSERT public.find_chain_place_id(v_chain) = 'ChIJzzcached00000000', 'still finds a cached store';
  RAISE NOTICE 'PASS: cached store';

  SELECT id INTO v_owner FROM public.restaurant_owners LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE NOTICE 'SKIP: no restaurant owner exists, claimed-store checks not exercised';
  ELSE
    -- A claimed store created later than the cached one is preferred.
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address, created_at)
    VALUES (v_owner, 'ChIJzzclaimed0000000', 'ZZ Claimed Place Chain #7', '1 Test St', NOW());
    ASSERT public.find_chain_place_id(v_chain) = 'ChIJzzclaimed0000000', 'finds a claimed store and prefers the newest';
    RAISE NOTICE 'PASS: claimed store is found';

    -- With no cached store at all, the claimed store alone is enough.
    DELETE FROM public.cached_restaurants WHERE place_id = 'ChIJzzcached00000000';
    ASSERT public.find_chain_place_id(v_chain) = 'ChIJzzclaimed0000000', 'a claimed store alone is enough';

    -- A claimed restaurant with a lookalike name must not match.
    DELETE FROM public.restaurants WHERE google_place_id = 'ChIJzzclaimed0000000';
    INSERT INTO public.restaurants (owner_id, google_place_id, name, address)
    VALUES (v_owner, 'ChIJzzlookalike00000', 'ZZ Claimed Place Chain Bistro', '2 Test St');
    ASSERT public.find_chain_place_id(v_chain) IS NULL, 'a name that only starts with the chain name does not match';
    RAISE NOTICE 'PASS: claimed-only and lookalike';
  END IF;

  -- Runs with its owner's rights, so the service role's table grants don't matter.
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.find_chain_place_id(uuid)'::regprocedure),
    'find_chain_place_id is SECURITY DEFINER';
  ASSERT has_table_privilege('service_role', 'public.cached_restaurants', 'SELECT'), 'service role may read cached_restaurants';
  ASSERT has_table_privilege('service_role', 'public.restaurants', 'SELECT'), 'service role may read restaurants';

  ASSERT NOT has_function_privilege('anon', 'public.find_chain_place_id(uuid)', 'EXECUTE'), 'anon cannot call it';
  ASSERT NOT has_function_privilege('authenticated', 'public.find_chain_place_id(uuid)', 'EXECUTE'), 'signed-in users cannot call it';
  ASSERT has_function_privilege('service_role', 'public.find_chain_place_id(uuid)', 'EXECUTE'), 'service role can call it';

  RAISE NOTICE 'ALL 082 TESTS PASSED';
END $$;

ROLLBACK;

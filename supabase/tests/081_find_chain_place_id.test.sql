-- Test for migration 081: find_chain_place_id picks a cached store of the chain,
-- by name or alias, newest first, and returns NULL when none is known.
-- Self-contained: creates its own chain and cached stores inside a transaction
-- and rolls back. Runs as the database owner, so it checks function logic, not
-- role grants (those are asserted from the catalog). Success: no error.
BEGIN;

DO $$
DECLARE
  v_chain  UUID;
  v_none   UUID;
BEGIN
  INSERT INTO public.franchise_chains (name, aliases) VALUES ('ZZ Place Id Chain', ARRAY['ZZ Placeid Co'])
  RETURNING id INTO v_chain;
  INSERT INTO public.franchise_chains (name, aliases) VALUES ('ZZ Chain Without Stores', ARRAY[]::TEXT[])
  RETURNING id INTO v_none;

  -- No cached store yet.
  ASSERT public.find_chain_place_id(v_chain) IS NULL, 'NULL when no store of the chain is cached';
  ASSERT public.find_chain_place_id(v_none) IS NULL, 'NULL for a chain with no stores';
  ASSERT public.find_chain_place_id(gen_random_uuid()) IS NULL, 'NULL for an unknown chain id';

  -- An older store, a newer store (name with a store number), one matched by alias, and a lookalike that must not match.
  INSERT INTO public.cached_restaurants (place_id, name, cached_at) VALUES
    ('ChIJzzold000000000000', 'ZZ Place Id Chain', NOW() - INTERVAL '5 days'),
    ('ChIJzznew000000000000', 'ZZ Place Id Chain #42', NOW() - INTERVAL '1 day'),
    ('ChIJzzalias0000000000', 'ZZ Placeid Co', NOW() - INTERVAL '10 days'),
    ('ChIJzzlookalike000000', 'ZZ Place Id Chain Cafe', NOW());

  ASSERT public.find_chain_place_id(v_chain) = 'ChIJzznew000000000000', 'picks the most recently cached matching store';
  ASSERT public.find_chain_place_id(v_chain) <> 'ChIJzzlookalike000000', 'a name that only starts with the chain name does not match';
  RAISE NOTICE 'PASS: find_chain_place_id picks the newest matching store';

  -- Alias-only chain still resolves.
  DELETE FROM public.cached_restaurants WHERE place_id IN ('ChIJzzold000000000000', 'ChIJzznew000000000000');
  ASSERT public.find_chain_place_id(v_chain) = 'ChIJzzalias0000000000', 'resolves a store matched by alias';
  RAISE NOTICE 'PASS: alias match';

  -- Only the edge function (service role) may call it.
  ASSERT NOT has_function_privilege('anon', 'public.find_chain_place_id(uuid)', 'EXECUTE'), 'anon cannot call it';
  ASSERT NOT has_function_privilege('authenticated', 'public.find_chain_place_id(uuid)', 'EXECUTE'), 'signed-in users cannot call it';
  ASSERT has_function_privilege('service_role', 'public.find_chain_place_id(uuid)', 'EXECUTE'), 'service role can call it';

  RAISE NOTICE 'ALL 081 TESTS PASSED';
END $$;

ROLLBACK;

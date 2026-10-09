-- Test for migration 113: a restaurant with no real items is put back in line for a real build.
-- Wiring is checked from the function text and access rules. The franchise helper is also run on a real chain inside a
-- transaction that is rolled back, so nothing is left behind. Needs migrations 087, 097, 101, 103 and 113.
-- Success: no error.
DO $$
DECLARE
  v_enq   TEXT := pg_get_functiondef('public.enqueue_menu_build(text,text)'::regprocedure);
  v_run   TEXT := pg_get_functiondef('public._start_chain_menu_builds(text)'::regprocedure);
  v_help  TEXT := pg_get_functiondef('public.mark_empty_chains_due(uuid)'::regprocedure);
  v_chain UUID;
  v_name  TEXT;
  v_after TIMESTAMPTZ;
BEGIN
  -- wiring
  ASSERT v_enq ILIKE '%mark_empty_chains_due%' AND v_enq ILIKE '%v_marked = 0%', 'a customer click marks an emptied franchise due instead of answering already_built';
  ASSERT v_enq ILIKE '%q.status = ''built''%' AND v_enq ILIKE '%next_attempt_at = NOW()%', 'an independent with no real items and a "built" job is set back to due';
  ASSERT position('ai\_%' IN v_enq) > 0, 'AI guesses do not count as a real menu for an independent';
  ASSERT position('chain\_%' IN v_help) > 0, 'only chain-built items count as a real menu for a franchise';
  ASSERT v_help ILIKE '%p_chain_id IS NOT NULL%' AND v_help ILIKE '%6 hours%' AND v_help ILIKE '%72 hours%', 'a failed build is retried only for a chain a customer opened, after the 6 / 72 hour delays';
  ASSERT v_help ILIKE '%needs_attention%', 'a chain flagged for an admin is left alone';
  ASSERT v_run ILIKE '%mark_empty_chains_due%', 'the franchise runner marks emptied franchises due first';
  ASSERT position('mark_empty_chains_due' IN v_run) < position('chains_needing_menu_build' IN v_run), 'it does so before choosing which chains to build';
  ASSERT NOT has_function_privilege('anon', 'public.mark_empty_chains_due(uuid)', 'EXECUTE'), 'anon cannot call it';
  ASSERT NOT has_function_privilege('authenticated', 'public.mark_empty_chains_due(uuid)', 'EXECUTE'), 'signed-in users cannot call it';
  ASSERT has_function_privilege('service_role', 'public.mark_empty_chains_due(uuid)', 'EXECUTE'), 'the server can';

  -- behaviour of the franchise helper, on a real chain (rolled back below)
  SELECT fc.id, fc.name INTO v_chain, v_name FROM public.franchise_chains fc WHERE fc.is_active ORDER BY fc.name LIMIT 1;
  IF v_chain IS NULL THEN
    RAISE NOTICE 'no active franchise chain to try the behaviour on; wiring checks only';
    RAISE NOTICE 'ALL 113 TESTS PASSED';
    RETURN;
  END IF;

  BEGIN
    DELETE FROM public.menu_build_queue q WHERE q.kind = 'chain' AND q.chain_id = v_chain;
    DELETE FROM public.menu_items mi WHERE mi.place_id IS NULL AND mi.restaurant_name = v_name AND mi.item_id LIKE 'chain\_%' ESCAPE '\';
    INSERT INTO public.franchise_menu_sources (chain_id, status, fetched_at, updated_at)
    VALUES (v_chain, 'ok', NOW(), NOW() - INTERVAL '1 hour')
    ON CONFLICT (chain_id) DO UPDATE SET status = 'ok', fetched_at = NOW();

    -- ok + emptied: marked, by the runner (no chain given) as well as by a click
    ASSERT public.mark_empty_chains_due() >= 1, 'an ok chain with no chain-built items is marked due by the runner';
    SELECT s.fetched_at INTO v_after FROM public.franchise_menu_sources s WHERE s.chain_id = v_chain;
    ASSERT v_after < NOW() - INTERVAL '300 days', 'its last-lookup date went back, so it counts as due';
    ASSERT public.mark_empty_chains_due(v_chain) = 0, 'running it again changes nothing (already due)';

    -- failed builds: only for a chain a customer opened, and only once the delay has passed
    UPDATE public.franchise_menu_sources SET status = 'error', fetched_at = NOW() - INTERVAL '1 hour' WHERE chain_id = v_chain;
    ASSERT public.mark_empty_chains_due(v_chain) = 0, 'an error 1 hour ago is not retried yet';
    UPDATE public.franchise_menu_sources SET fetched_at = NOW() - INTERVAL '7 hours' WHERE chain_id = v_chain;
    ASSERT public.mark_empty_chains_due() = 0 OR NOT EXISTS (
      SELECT 1 FROM public.franchise_menu_sources s WHERE s.chain_id = v_chain AND s.fetched_at < NOW() - INTERVAL '300 days'
    ), 'the runner never retries a failed chain nobody opened';
    ASSERT public.mark_empty_chains_due(v_chain) = 1, 'an error 7 hours ago is retried when a customer opens the chain';

    UPDATE public.franchise_menu_sources SET status = 'no_menu_link', fetched_at = NOW() - INTERVAL '10 hours' WHERE chain_id = v_chain;
    ASSERT public.mark_empty_chains_due(v_chain) = 0, 'no menu link 10 hours ago waits for the 72 hour delay';
    UPDATE public.franchise_menu_sources SET fetched_at = NOW() - INTERVAL '73 hours' WHERE chain_id = v_chain;
    ASSERT public.mark_empty_chains_due(v_chain) = 1, 'no menu link 73 hours ago is retried when a customer opens the chain';

    -- never while a lookup is in flight, and never when the chain was flagged for an admin
    UPDATE public.franchise_menu_sources SET status = 'pending', fetched_at = NOW() - INTERVAL '5 days' WHERE chain_id = v_chain;
    ASSERT public.mark_empty_chains_due(v_chain) = 0, 'a pending lookup is left alone';
    UPDATE public.franchise_menu_sources SET status = 'error', fetched_at = NOW() - INTERVAL '3 days' WHERE chain_id = v_chain;
    INSERT INTO public.menu_build_queue (kind, chain_id, restaurant_name, status, attempts, next_attempt_at)
    VALUES ('chain', v_chain, v_name, 'needs_attention', 3, 'infinity');
    ASSERT public.mark_empty_chains_due(v_chain) = 0, 'a chain flagged needs_attention is not retried automatically';
    DELETE FROM public.menu_build_queue q WHERE q.kind = 'chain' AND q.chain_id = v_chain;

    -- a chain that has a chain-built item is left alone
    UPDATE public.franchise_menu_sources SET status = 'ok', fetched_at = NOW() WHERE chain_id = v_chain;
    INSERT INTO public.menu_items (
      item_id, restaurant_name, name, calories, protein_g, total_carbs_g, total_fat_g, saturated_fat_g, sodium_mg,
      is_verified, cached_at
    ) VALUES (
      'chain_test113_' || replace(v_chain::text, '-', ''), v_name, 'Test113 Item', 100, 0, 0, 0, 0, 0, true, NOW()
    );
    ASSERT public.mark_empty_chains_due(v_chain) = 0, 'a chain with a chain-built item is not marked due';

    RAISE EXCEPTION 'rollback_test_113';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_113' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 113 TESTS PASSED';
END $$;

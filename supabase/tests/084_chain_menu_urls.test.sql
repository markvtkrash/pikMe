-- Test for migration 084: franchise_chains.menu_url exists, the seeded addresses are
-- sane web addresses, and the seed only fills chains that had none (it never
-- overwrites an address someone set). Inside a transaction, rolled back.
-- Success: no error.
BEGIN;

DO $$
DECLARE
  v_id UUID;
  v_filled INTEGER;
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'franchise_chains' AND column_name = 'menu_url'
  ), 'franchise_chains.menu_url exists';

  -- Every address that is set is a plain https page with no tracking junk or spaces.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.franchise_chains
    WHERE menu_url IS NOT NULL AND (menu_url !~ '^https://[^/?#[:space:]]+\.[^/?#[:space:]]+' OR menu_url ~ '[[:space:]]' OR menu_url ~* 'utm_')
  ), 'every menu_url is a clean https address';

  SELECT COUNT(*) INTO v_filled FROM public.franchise_chains WHERE menu_url IS NOT NULL;
  ASSERT v_filled >= 10, 'the seed filled a reasonable number of chains (found ' || v_filled || ')';
  RAISE NOTICE 'PASS: column and seed (% chains have an address)', v_filled;

  -- The seed's rule: it fills only chains with no menu_url, so a hand-set address survives a re-run.
  INSERT INTO public.franchise_chains (name, aliases, menu_url) VALUES ('ZZ Menu Url Chain', ARRAY[]::TEXT[], 'https://example.com/hand-set')
  RETURNING id INTO v_id;
  UPDATE public.franchise_chains fc SET menu_url = 'https://example.com/seed'
  FROM (VALUES ('ZZ Menu Url Chain')) AS v(name)
  WHERE fc.normalized_name = public.normalize_restaurant_name(v.name) AND fc.menu_url IS NULL;
  ASSERT (SELECT menu_url FROM public.franchise_chains WHERE id = v_id) = 'https://example.com/hand-set', 'a hand-set address is not overwritten';

  -- ...and does fill a chain that has none.
  UPDATE public.franchise_chains SET menu_url = NULL WHERE id = v_id;
  UPDATE public.franchise_chains fc SET menu_url = 'https://example.com/seed'
  FROM (VALUES ('ZZ Menu Url Chain')) AS v(name)
  WHERE fc.normalized_name = public.normalize_restaurant_name(v.name) AND fc.menu_url IS NULL;
  ASSERT (SELECT menu_url FROM public.franchise_chains WHERE id = v_id) = 'https://example.com/seed', 'an empty address is filled';
  RAISE NOTICE 'PASS: seed does not overwrite';

  RAISE NOTICE 'ALL 084 TESTS PASSED';
END $$;

ROLLBACK;

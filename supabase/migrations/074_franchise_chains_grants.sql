-- Table privileges for franchise_chains. Migration 062 created the table and its
-- row-level-security policies but no GRANTs. Row-level security decides WHICH
-- rows a role may see; the GRANT decides whether it may touch the table at all,
-- so without these every call fails with "permission denied for table
-- franchise_chains" (code 42501) however permissive the policy is.
--
-- Earlier instances were patched by hand for anon/authenticated; this makes the
-- migrations match, and adds service_role, which the get-chain-menu edge
-- function connects as (find_franchise_chain reads this table).
-- GRANT is idempotent, so this is safe on a database that already has them.

-- Anyone can read the public chain list (the app checks it before sign-in).
GRANT SELECT ON public.franchise_chains TO anon, authenticated;
-- Admins write through the admin app; the policy "franchise_chains_admin_write"
-- still limits that to users with the admin role.
GRANT INSERT, UPDATE, DELETE ON public.franchise_chains TO authenticated;
GRANT ALL ON public.franchise_chains TO service_role;

NOTIFY pgrst, 'reload schema';

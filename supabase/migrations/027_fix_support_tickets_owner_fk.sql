-- Migration: 027_fix_support_tickets_owner_fk
-- Purpose: 026 pointed support_tickets.owner_id at auth.users(id) directly.
-- PostgREST can't use that for embedding (the auth schema isn't exposed to
-- it), which is why the admin tickets list failed with PGRST200. Repoint the
-- FK at public.restaurant_owners(id) instead — same underlying id
-- (restaurant_owners.id already references auth.users(id)), but now
-- PostgREST can auto-detect the relationship, matching the same pattern
-- restaurants.owner_id already uses.
-- Date: 2026-08-17

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_owner_id_fkey;

ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.restaurant_owners(id) ON DELETE CASCADE;

-- Migration: 053_owner_favorite_pages
-- Purpose: "Favorites" dashboard section. An owner can heart a Reports card
--          or a Tools page to pin a shortcut to it at the top of the
--          Dashboard. Scoped to Reports (5 pages) and Tools (3 pages) --
--          Dashboard's own quick-links are excluded, since they're already
--          always visible there. Just an array of known page keys on the
--          owner's own row -- no new table needed, and the existing RLS
--          policy on restaurant_owners ("owners can update own record")
--          already covers writing to it directly from the client.
-- Date: 2026-09-22

ALTER TABLE public.restaurant_owners
ADD COLUMN IF NOT EXISTS favorite_pages TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.restaurant_owners.favorite_pages IS
  'Page keys (matching the FAVORITABLE_PAGES registry in the owner app) the owner has pinned to their Dashboard Favorites section.';

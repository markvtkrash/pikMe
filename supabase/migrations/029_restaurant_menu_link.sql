-- Migration: 029_restaurant_menu_link
-- Purpose: Let a restaurant owner attach a link to their real online menu.
-- The extract-menu-from-link edge function reads this and (re)populates
-- public.menu_items — the same cache table fetch-menu-items-ai already
-- writes to, so the consumer app's recommendation engine needs no changes.
-- Date: 2026-09-07

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS menu_link TEXT;

COMMENT ON COLUMN public.restaurants.menu_link IS 'Owner-provided URL to the restaurant''s real menu, used to extract verified menu items instead of relying on AI-guessed ones.';

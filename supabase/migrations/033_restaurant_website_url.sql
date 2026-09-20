-- Migration: 033_restaurant_website_url
-- Purpose: Store the restaurant's official website, sourced from Google
--          Place Details at claim time (not owner-self-reported, so it's an
--          independent anchor). Used to hard-block the "Upload Menu" link
--          feature from accepting a URL on any other domain, closing the gap
--          where an owner could otherwise paste any arbitrary link (a
--          competitor's menu, an unrelated page) and have it accepted as
--          "verified" data.
-- Date: 2026-09-16

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS website_url TEXT;

COMMENT ON COLUMN public.restaurants.website_url IS
  'Official website from Google Place Details at claim time, if Google has one on file. NULL for businesses with no website on Google — those owners are not domain-restricted on the menu-link feature since there is no known-good anchor to check against.';

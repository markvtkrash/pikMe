-- Starter favorites for owners. A new owner login starts with five pinned pages instead of an empty Favorites list, and owners who
-- have never pinned anything get the same five once.
--
--   coupon-add-coupons              Add Coupons
--   menu-online-link                Import Menu from Online Link
--   menu-photo                      Import Menu from Photo
--   report-menu-verification-status Menu Verification Status
--   tool-visibility                 Pause My Restaurant
--
-- These are the page keys of owner/src/constants/favoritablePages.ts. An owner can unpin any of them and it stays unpinned: the
-- one-time seeding below runs only the first time this migration is applied (a marker row in app_config records that), so
-- re-running it never puts pins back. To change the starter set for FUTURE owners, change the default in a later migration.

ALTER TABLE public.restaurant_owners
  ALTER COLUMN favorite_pages
  SET DEFAULT ARRAY['coupon-add-coupons', 'menu-online-link', 'menu-photo', 'report-menu-verification-status', 'tool-visibility']::TEXT[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'starterFavoritesSeeded') THEN
    UPDATE public.restaurant_owners
       SET favorite_pages = ARRAY['coupon-add-coupons', 'menu-online-link', 'menu-photo', 'report-menu-verification-status', 'tool-visibility']::TEXT[]
     WHERE cardinality(favorite_pages) = 0;

    INSERT INTO public.app_config (key, value, description, env_var_name)
    VALUES ('starterFavoritesSeeded', 'true', 'Marker: the starter favorites were given once to owners with no pins (migration 133). Do not change.', 'Owner app: no .env equivalent, DB-only');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

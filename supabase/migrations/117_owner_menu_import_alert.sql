-- Tells an owner when the daily read of THEIR menu link (the browser crawl, migration 114) did not get any menu items,
-- so the owner app can show a bell alert at the top of the page suggesting "Import Menu from Photo".
--
--   owner_menu_import_alert()           the alert for the signed-in owner's approved restaurant, or no row. It shows when the last
--                                       read of the owner's own menu link ended with
--                                          no_items          the page was read but held no dishes (usually a menu that is a picture)
--                                          needs_attention   the page could not be read after several tries
--                                       and none of these is true:
--                                          - the link was changed or saved again since (the read is pending again),
--                                          - the owner dismissed this result,
--                                          - the owner has since added real menu items (a photo or text import, ...).
--                                       Only the owner's OWN link counts (an admin's override link is not the owner's concern).
--   owner_dismiss_menu_import_alert()   hides the current result. A later read that ends the same way shows it again.
--
-- Everything is limited to the signed-in owner's own restaurant. Safe to re-run.

ALTER TABLE public.place_menu_crawl ADD COLUMN IF NOT EXISTS owner_dismissed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.owner_menu_import_alert()
RETURNS TABLE (alert_status TEXT, alert_link TEXT, alert_finished_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.status, c.link, c.finished_at
  FROM public.restaurants r
  JOIN public.place_menu_crawl c ON c.place_id = r.google_place_id
  WHERE r.owner_id = auth.uid()
    AND r.status = 'approved'
    AND c.link_source = 'owner'
    AND c.link = r.menu_link
    AND c.status IN ('no_items', 'needs_attention')
    AND c.finished_at IS NOT NULL
    AND (c.owner_dismissed_at IS NULL OR c.owner_dismissed_at < c.finished_at)
    AND NOT EXISTS (
      -- the owner followed the advice: real menu items were added after the failed read
      SELECT 1 FROM public.menu_items mi
      WHERE mi.place_id = r.google_place_id
        AND mi.item_id NOT LIKE 'ai\_%' ESCAPE '\'
        AND mi.cached_at > c.finished_at
    )
  ORDER BY (c.status = 'needs_attention') DESC, c.finished_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.owner_menu_import_alert() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_menu_import_alert() TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_dismiss_menu_import_alert()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.place_menu_crawl c
     SET owner_dismissed_at = NOW()
    FROM public.restaurants r
   WHERE r.owner_id = auth.uid()
     AND r.google_place_id = c.place_id;
$$;

REVOKE ALL ON FUNCTION public.owner_dismiss_menu_import_alert() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_dismiss_menu_import_alert() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- The owner is told about a menu link that worked for the admin, even after the admin's save replaced the record of the
-- owner's failed read.
--
-- Before (migration 122) the note below the owner's link box only showed while the crawler's latest record was the owner's
-- own link and that read had failed. When an admin corrected the link, the admin's save replaced that record, the read
-- succeeded, and the owner was told nothing.
--
--   owner_menu_link_help   one row for the signed-in owner's approved restaurant when EITHER
--                            - the last read of the owner's own link found no dishes or failed (owner_link_failed = true), or
--                            - an admin's link worked and is different from the owner's saved link (a working link to point
--                              them to, even though their own read is no longer on record).
--                          suggested_link is the admin's link only when it worked and differs from the owner's; else NULL.
--                          Nothing if the owner has no saved link and no failed read. Never reveals who set the link or
--                          anything about other restaurants.
--
-- Safe to re-run.

DROP FUNCTION IF EXISTS public.owner_menu_link_help();

CREATE FUNCTION public.owner_menu_link_help()
RETURNS TABLE (suggested_link TEXT, owner_link_failed BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.suggested_link, x.owner_link_failed
  FROM (
    SELECT
      CASE
        WHEN q.override_link_ok IS TRUE
             AND NULLIF(btrim(q.override_link), '') IS NOT NULL
             AND q.override_link IS DISTINCT FROM r.menu_link
        THEN q.override_link
      END AS suggested_link,
      (
        c.link_source = 'owner'
        AND c.link = r.menu_link
        AND c.status IN ('no_items', 'needs_attention')
        AND c.finished_at IS NOT NULL
        AND NOT EXISTS (
          -- the owner followed the advice: real menu items were added after the failed read
          SELECT 1 FROM public.menu_items mi
          WHERE mi.place_id = r.google_place_id
            AND mi.item_id NOT LIKE 'ai\_%' ESCAPE '\'
            AND mi.cached_at > c.finished_at
        )
      ) AS owner_link_failed,
      c.status AS crawl_status,
      c.finished_at AS crawl_finished_at,
      (r.menu_link IS NOT NULL AND btrim(r.menu_link) <> '') AS owner_has_link
    FROM public.restaurants r
    LEFT JOIN public.place_menu_crawl c ON c.place_id = r.google_place_id
    LEFT JOIN public.menu_build_queue q ON q.kind = 'place' AND q.place_id = r.google_place_id
    WHERE r.owner_id = auth.uid()
      AND r.status = 'approved'
  ) x
  WHERE COALESCE(x.owner_link_failed, FALSE)
     OR (x.suggested_link IS NOT NULL AND x.owner_has_link)
  ORDER BY COALESCE(x.owner_link_failed, FALSE) DESC, (x.crawl_status = 'needs_attention') DESC, x.crawl_finished_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.owner_menu_link_help() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_menu_link_help() TO authenticated;

NOTIFY pgrst, 'reload schema';

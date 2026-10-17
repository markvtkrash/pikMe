-- What a customer will find on a restaurant's menu, in one word, for a whole list of restaurants at once (used by fetch-nearby-restaurants to
-- put a badge on each card).
--
--   confirmed   at least one item on the menu is confirmed (is_verified = true)
--   estimated   there are items, but none is confirmed yet (AI estimates)
--   none        no items at all
--
-- It asks get_menu_items_for_restaurant, the function the restaurant page itself uses, so the badge always agrees with what the page shows:
-- the place's own items, else a franchise's shared chain menu, and nothing for a place that is not listed (migration 139/140).
-- p_place_ids and p_names are parallel arrays (the same position is the same restaurant). A place ID given twice is answered once.

CREATE OR REPLACE FUNCTION public.menu_status_for_places(p_place_ids TEXT[], p_names TEXT[])
RETURNS TABLE (place_id TEXT, status TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT t.place_id,
         CASE
           WHEN COUNT(m.item_id) FILTER (WHERE m.is_verified) > 0 THEN 'confirmed'
           WHEN COUNT(m.item_id) > 0 THEN 'estimated'
           ELSE 'none'
         END AS status
  FROM (
    SELECT DISTINCT ON (x.pid) x.pid AS place_id, x.pname
    FROM unnest(p_place_ids, p_names) AS x(pid, pname)
    WHERE x.pid IS NOT NULL
    ORDER BY x.pid
  ) t
  LEFT JOIN LATERAL public.get_menu_items_for_restaurant(t.place_id, t.pname) m ON TRUE
  GROUP BY t.place_id;
$$;

GRANT EXECUTE ON FUNCTION public.menu_status_for_places(TEXT[], TEXT[]) TO anon, authenticated, service_role;

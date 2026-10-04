-- Per-location menus, stage 1 (schema + read path only; no behavior change).
--
-- menu_items has always been keyed by restaurant NAME, so every location of a
-- chain shared one item set and one owner's edit rewrote it for all of them.
-- Direction (see the design discussion): keep the existing name-keyed rows as
-- a shared TEMPLATE, and let a claimed location own its OWN rows, tied to its
-- Google place ID. The consumer app reads the location's own items when it
-- has any, otherwise falls back to the template.
--
--   place_id IS NULL      -> shared template (every row that exists today,
--                            AI-generated or otherwise), matched by name
--   place_id = '<place>'  -> that single location's own menu
--
-- This migration only adds the column and the read function. Nothing writes a
-- place_id yet, so until the later stages ship every row is a template and
-- get_menu_items_for_restaurant behaves exactly like the old name lookup.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS place_id TEXT;

COMMENT ON COLUMN public.menu_items.place_id IS
  'NULL = shared name-keyed template menu; otherwise the Google place ID of the single location that owns this row.';

-- Partial index: template rows (the vast majority) don't pay for it.
CREATE INDEX IF NOT EXISTS idx_menu_items_place_id
  ON public.menu_items (place_id)
  WHERE place_id IS NOT NULL;

-- ── Read path ────────────────────────────────────────────────────────────────
-- Returns the in-stock items a customer should see for one restaurant:
--   1. If the location has ANY row of its own (even if every one is currently
--      out of stock) use only the location's rows. Otherwise an owner who
--      marked everything out of stock would silently get the template back.
--   2. Otherwise use the shared template: place_id IS NULL rows whose
--      restaurant_name matches EXACTLY (same comparison the app always used).
-- Runs as the caller (SECURITY INVOKER), same access the direct table query had.
CREATE OR REPLACE FUNCTION public.get_menu_items_for_restaurant(
  p_place_id TEXT,
  p_restaurant_name TEXT
)
RETURNS SETOF public.menu_items
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_place_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.menu_items mi WHERE mi.place_id = p_place_id
  ) THEN
    RETURN QUERY
    SELECT mi.*
    FROM public.menu_items mi
    WHERE mi.place_id = p_place_id
      AND mi.is_out_of_stock = FALSE;
  ELSE
    RETURN QUERY
    SELECT mi.*
    FROM public.menu_items mi
    WHERE mi.place_id IS NULL
      AND mi.restaurant_name = p_restaurant_name
      AND mi.is_out_of_stock = FALSE;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_items_for_restaurant(TEXT, TEXT) TO anon, authenticated;

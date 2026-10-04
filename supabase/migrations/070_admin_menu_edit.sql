-- Admin "Manual Edit" for menus: add an item, update an item, mass delete items,
-- plus the read helpers that page needs. Admin-only (same _require_admin() guard
-- as the other admin RPCs); the owner tools stay owner-scoped.
--
-- menu_items is still keyed by restaurant NAME (per-location menus are a later
-- stage), so an edit applies to every location sharing that name. The page
-- warns about that using admin_menu_sharing_info. When per-location menus are
-- built, these functions are the single place to retarget at one place_id.
--
-- Items an admin ADDS are created unverified unless the admin explicitly sets
-- the verified flag, so "verified" keeps meaning "confirmed by the restaurant"
-- unless someone deliberately says otherwise.

-- ── 1. Deterministic id for admin-created items ──────────────────────────────
-- Same restaurant + same item name (case/whitespace-insensitive) -> same id, so
-- retyping a dish can never create a duplicate row.
CREATE OR REPLACE FUNCTION public.admin_menu_item_id(p_restaurant_name TEXT, p_item_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'admin_' || left(
    md5(lower(btrim(COALESCE(p_restaurant_name, ''))) || '::' || lower(btrim(COALESCE(p_item_name, '')))),
    24
  );
$$;

-- ── 2. Read: every column the edit form needs ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_restaurant_menu_for_edit(p_restaurant_name TEXT)
RETURNS TABLE (
  item_id TEXT,
  name TEXT,
  calories INTEGER,
  protein_g NUMERIC,
  total_carbs_g NUMERIC,
  total_fat_g NUMERIC,
  saturated_fat_g NUMERIC,
  sodium_mg INTEGER,
  dietary_fiber_g NUMERIC,
  sugars_g NUMERIC,
  serving_weight_grams NUMERIC,
  is_verified BOOLEAN,
  is_out_of_stock BOOLEAN,
  nutrition_source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    mi.item_id, mi.name, mi.calories, mi.protein_g, mi.total_carbs_g,
    mi.total_fat_g, mi.saturated_fat_g, mi.sodium_mg, mi.dietary_fiber_g,
    mi.sugars_g, mi.serving_weight_grams,
    COALESCE(mi.is_verified, false),
    COALESCE(mi.is_out_of_stock, false),
    mi.nutrition_source
  FROM public.menu_items mi
  WHERE mi.restaurant_name = p_restaurant_name
  ORDER BY mi.name;
END;
$$;

-- ── 3. Read: how many locations share this menu ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_menu_sharing_info(p_restaurant_name TEXT)
RETURNS TABLE (cached_locations BIGINT, claimed_locations BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.cached_restaurants cr WHERE cr.name = p_restaurant_name),
    (SELECT COUNT(*) FROM public.restaurants r WHERE r.name = p_restaurant_name);
END;
$$;

-- ── 4. Add or update one item ────────────────────────────────────────────────
-- p_item_id NULL  -> create (error if the restaurant already has an item with
--                    that name; edit the existing one instead)
-- p_item_id given -> update that item (rename allowed unless it collides)
-- Calories are required; other nutrition values default to 0. A change to any
-- nutrition value marks the row nutrition_source = 'owner_provided' (a person
-- entered the numbers, not the AI); a name/flag-only edit leaves it alone.
CREATE OR REPLACE FUNCTION public.admin_save_menu_item(
  p_restaurant_name      TEXT,
  p_item_id              TEXT,
  p_name                 TEXT,
  p_calories             INTEGER,
  p_protein_g            NUMERIC,
  p_total_carbs_g        NUMERIC,
  p_total_fat_g          NUMERIC,
  p_saturated_fat_g      NUMERIC,
  p_sodium_mg            INTEGER,
  p_dietary_fiber_g      NUMERIC,
  p_sugars_g             NUMERIC,
  p_serving_weight_grams NUMERIC,
  p_is_verified          BOOLEAN,
  p_is_out_of_stock      BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rest     TEXT := btrim(COALESCE(p_restaurant_name, ''));
  v_name     TEXT := btrim(COALESCE(p_name, ''));
  v_id       TEXT;
  v_existing public.menu_items%ROWTYPE;
  v_changed  BOOLEAN;
BEGIN
  PERFORM public._require_admin();

  IF v_rest = '' THEN RAISE EXCEPTION 'Restaurant name is required'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'Item name is required'; END IF;
  IF p_calories IS NULL THEN RAISE EXCEPTION 'Calories are required'; END IF;
  IF p_calories < 0
     OR COALESCE(p_protein_g, 0) < 0 OR COALESCE(p_total_carbs_g, 0) < 0
     OR COALESCE(p_total_fat_g, 0) < 0 OR COALESCE(p_saturated_fat_g, 0) < 0
     OR COALESCE(p_sodium_mg, 0) < 0 OR COALESCE(p_dietary_fiber_g, 0) < 0
     OR COALESCE(p_sugars_g, 0) < 0 OR COALESCE(p_serving_weight_grams, 0) < 0 THEN
    RAISE EXCEPTION 'Nutrition values cannot be negative';
  END IF;

  IF p_item_id IS NULL THEN
    -- Create
    IF EXISTS (
      SELECT 1 FROM public.menu_items mi
      WHERE mi.restaurant_name = v_rest AND lower(btrim(mi.name)) = lower(v_name)
    ) THEN
      RAISE EXCEPTION 'An item named "%" already exists for this restaurant', v_name;
    END IF;

    v_id := public.admin_menu_item_id(v_rest, v_name);

    INSERT INTO public.menu_items (
      item_id, restaurant_name, name, calories, protein_g, total_carbs_g,
      total_fat_g, saturated_fat_g, sodium_mg, dietary_fiber_g, sugars_g,
      serving_weight_grams, is_verified, is_out_of_stock, nutrition_source, cached_at
    ) VALUES (
      v_id, v_rest, v_name, p_calories,
      COALESCE(p_protein_g, 0), COALESCE(p_total_carbs_g, 0),
      COALESCE(p_total_fat_g, 0), COALESCE(p_saturated_fat_g, 0),
      COALESCE(p_sodium_mg, 0), COALESCE(p_dietary_fiber_g, 0),
      COALESCE(p_sugars_g, 0), p_serving_weight_grams,
      COALESCE(p_is_verified, false), COALESCE(p_is_out_of_stock, false),
      'owner_provided', NOW()
    );

    RETURN jsonb_build_object('itemId', v_id, 'created', true);
  END IF;

  -- Update
  SELECT * INTO v_existing FROM public.menu_items mi WHERE mi.item_id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Menu item not found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.restaurant_name = v_existing.restaurant_name
      AND mi.item_id <> p_item_id
      AND lower(btrim(mi.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'Another item named "%" already exists for this restaurant', v_name;
  END IF;

  v_changed :=
    v_existing.calories        IS DISTINCT FROM p_calories
    OR v_existing.protein_g     IS DISTINCT FROM COALESCE(p_protein_g, 0)
    OR v_existing.total_carbs_g IS DISTINCT FROM COALESCE(p_total_carbs_g, 0)
    OR v_existing.total_fat_g   IS DISTINCT FROM COALESCE(p_total_fat_g, 0)
    OR v_existing.saturated_fat_g IS DISTINCT FROM COALESCE(p_saturated_fat_g, 0)
    OR v_existing.sodium_mg     IS DISTINCT FROM COALESCE(p_sodium_mg, 0)
    OR v_existing.dietary_fiber_g IS DISTINCT FROM COALESCE(p_dietary_fiber_g, 0)
    OR v_existing.sugars_g      IS DISTINCT FROM COALESCE(p_sugars_g, 0)
    OR v_existing.serving_weight_grams IS DISTINCT FROM p_serving_weight_grams;

  UPDATE public.menu_items SET
    name                 = v_name,
    calories             = p_calories,
    protein_g            = COALESCE(p_protein_g, 0),
    total_carbs_g        = COALESCE(p_total_carbs_g, 0),
    total_fat_g          = COALESCE(p_total_fat_g, 0),
    saturated_fat_g      = COALESCE(p_saturated_fat_g, 0),
    sodium_mg            = COALESCE(p_sodium_mg, 0),
    dietary_fiber_g      = COALESCE(p_dietary_fiber_g, 0),
    sugars_g             = COALESCE(p_sugars_g, 0),
    serving_weight_grams = p_serving_weight_grams,
    is_verified          = COALESCE(p_is_verified, false),
    is_out_of_stock      = COALESCE(p_is_out_of_stock, false),
    nutrition_source     = CASE WHEN v_changed THEN 'owner_provided' ELSE nutrition_source END,
    cached_at            = NOW()
  WHERE item_id = p_item_id;

  RETURN jsonb_build_object('itemId', p_item_id, 'created', false);
END;
$$;

-- ── 5. Mass delete ───────────────────────────────────────────────────────────
-- p_dry_run = true returns what WOULD happen (for the confirmation dialog)
-- without deleting. Deleting also removes customers' saved copies of the items
-- (ON DELETE CASCADE, migrations 030/034) and deactivates any active
-- item-specific coupon pointing at them (trigger from migration 044).
CREATE OR REPLACE FUNCTION public.admin_delete_menu_items(
  p_item_ids TEXT[],
  p_dry_run  BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_items   INTEGER := 0;
  v_coupons INTEGER := 0;
  v_saved   INTEGER := 0;
BEGIN
  PERFORM public._require_admin();

  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RETURN jsonb_build_object('items', 0, 'coupons', 0, 'savedCopies', 0, 'deleted', false);
  END IF;
  IF cardinality(p_item_ids) > 500 THEN
    RAISE EXCEPTION 'Delete at most 500 items at a time';
  END IF;

  SELECT COUNT(*) INTO v_items FROM public.menu_items WHERE item_id = ANY(p_item_ids);

  SELECT COUNT(*) INTO v_coupons
  FROM public.coupons
  WHERE menu_item_id = ANY(p_item_ids)
    AND coupon_type IN ('item_percent', 'item_fixed')
    AND is_active = true
    AND is_deleted = false;

  SELECT COUNT(*) INTO v_saved FROM public.saved_menu_items WHERE item_id = ANY(p_item_ids);

  IF NOT COALESCE(p_dry_run, false) THEN
    DELETE FROM public.menu_items WHERE item_id = ANY(p_item_ids);
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'coupons', v_coupons,
    'savedCopies', v_saved,
    'deleted', NOT COALESCE(p_dry_run, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_menu_item_id(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_restaurant_menu_for_edit(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_menu_sharing_info(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_menu_item(
  TEXT, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, NUMERIC, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_menu_items(TEXT[], BOOLEAN) TO authenticated;

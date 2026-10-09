-- Place-aware menu saving (phase 1 of per-place menus).
--
-- Until now every menu item was saved under the restaurant NAME, so two restaurants with the same name shared
-- one set of items. The customer lookup already reads a place's own items first (migration 067); this adds the
-- database functions that can SAVE and DELETE items for one place, and makes the owner actions check ownership
-- by place. Nothing calls the new save functions yet (the edge functions and apps change in the next phase), so
-- applying this changes no behaviour except the owner ownership check below.
--
--   place_item_id(place, id)                  an item id that is unique to that place, keeping the id's source prefix
--   upsert_place_menu_items(place, name, items)   saves items for ONE place (service role only; never for a franchise)
--   delete_place_menu_items(place, only_unverified)   removes ONE place's items (service role only)
--   verify / unverify / delete / out-of-stock (owner)  now find the owning restaurant by place for place items
--
-- Franchises are never saved per place: upsert_place_menu_items refuses a chain's name, because a chain keeps one
-- shared menu by name. Safe to re-run.

-- ── 1. An id that cannot collide between two places ─────────────────────────
-- menu_items.item_id is the primary key and is built from the restaurant name and the dish, so two places with
-- the same name would produce the same id for the same dish. Mixing the place into the id keeps each place's
-- rows separate while keeping the source prefix (image_, text_, manual_, link_, ai_...).
CREATE OR REPLACE FUNCTION public.place_item_id(p_place_id TEXT, p_item_id TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT split_part(p_item_id, '_', 1) || '_'
         || left(encode(sha256(convert_to(p_place_id || '::' || p_item_id, 'UTF8')), 'hex'), 24);
$$;

REVOKE ALL ON FUNCTION public.place_item_id(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_item_id(TEXT, TEXT) TO service_role;

-- ── 2. Save items for one place ─────────────────────────────────────────────
-- p_items has the same shape the edge functions already send to upsert_menu_items (itemId, name, nutrition,
-- isVerified, ...). Each item's id is made unique to the place, its restaurant name is set to p_restaurant_name,
-- the rows are saved through the existing upsert_menu_items (so whatever it does for nutrition columns still
-- applies), and then tied to the place. Returns how many items were saved.
CREATE OR REPLACE FUNCTION public.upsert_place_menu_items(
  p_place_id        TEXT,
  p_restaurant_name TEXT,
  p_items           JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
  v_ids   TEXT[];
BEGIN
  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' THEN
    RAISE EXCEPTION 'A valid Google place ID is required';
  END IF;
  IF p_restaurant_name IS NULL OR btrim(p_restaurant_name) = '' THEN
    RAISE EXCEPTION 'The restaurant name is required';
  END IF;
  IF public.is_franchise_chain(p_restaurant_name) THEN
    RAISE EXCEPTION 'A franchise restaurant uses the shared chain menu and cannot have a menu of its own';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RETURN 0;
  END IF;

  SELECT jsonb_agg(
           jsonb_set(
             jsonb_set(i, '{itemId}', to_jsonb(public.place_item_id(p_place_id, i->>'itemId'))),
             '{restaurantName}', to_jsonb(btrim(p_restaurant_name))
           )
         ),
         array_agg(public.place_item_id(p_place_id, i->>'itemId'))
    INTO v_items, v_ids
  FROM jsonb_array_elements(p_items) AS i
  WHERE COALESCE(i->>'itemId', '') <> '';

  IF v_items IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM public.upsert_menu_items(v_items);

  UPDATE public.menu_items SET place_id = p_place_id WHERE item_id = ANY (v_ids);
  RETURN cardinality(v_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_place_menu_items(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_place_menu_items(TEXT, TEXT, JSONB) TO service_role;

-- ── 3. Remove one place's items ─────────────────────────────────────────────
-- Only rows tied to that place: other places with the same name, and the shared name-keyed items, are untouched.
-- (Customers' saved copies of a deleted item go with it, as with any menu item delete: saved_menu_items cascades.)
CREATE OR REPLACE FUNCTION public.delete_place_menu_items(
  p_place_id        TEXT,
  p_only_unverified BOOLEAN DEFAULT FALSE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_place_id IS NULL OR p_place_id !~ '^[A-Za-z0-9_-]{10,200}$' THEN
    RAISE EXCEPTION 'A valid Google place ID is required';
  END IF;
  DELETE FROM public.menu_items mi
  WHERE mi.place_id = p_place_id
    AND (NOT COALESCE(p_only_unverified, FALSE) OR COALESCE(mi.is_verified, false) = false);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_place_menu_items(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_place_menu_items(TEXT, BOOLEAN) TO service_role;

-- ── 4. Owner actions: ownership by place for place items ────────────────────
-- Same four functions as migration 080 with ONE change each: an item tied to a place is checked against the
-- restaurant with THAT place ID (so two restaurants with the same name cannot act on each other's items);
-- a name-keyed item is checked by name exactly as before. Everything else (the franchise refusal, the coupon
-- warning on delete, the update itself) is unchanged.
CREATE OR REPLACE FUNCTION public.verify_menu_item(p_item_id TEXT, p_new_name TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_restaurant_name TEXT;
  v_place_id        TEXT;
  v_owner_id        UUID;
BEGIN
  SELECT restaurant_name, place_id INTO v_restaurant_name, v_place_id
  FROM public.menu_items
  WHERE item_id = p_item_id;

  IF v_restaurant_name IS NULL THEN
    RAISE EXCEPTION 'Menu item not found';
  END IF;

  SELECT owner_id INTO v_owner_id
  FROM public.restaurants
  WHERE CASE WHEN v_place_id IS NOT NULL
             THEN google_place_id = v_place_id
             ELSE lower(trim(name)) = lower(trim(v_restaurant_name)) END
  LIMIT 1;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to modify this menu item';
  END IF;

  IF public.is_franchise_chain(v_restaurant_name) THEN
    RAISE EXCEPTION 'This restaurant is part of a chain. Its menu is managed centrally and cannot be changed here.';
  END IF;

  IF p_new_name IS NOT NULL AND trim(p_new_name) <> '' THEN
    UPDATE public.menu_items SET name = trim(p_new_name), is_verified = TRUE WHERE item_id = p_item_id;
  ELSE
    UPDATE public.menu_items SET is_verified = TRUE WHERE item_id = p_item_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.verify_menu_item(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.unverify_menu_item(p_item_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_restaurant_name TEXT;
  v_place_id        TEXT;
  v_owner_id        UUID;
BEGIN
  SELECT restaurant_name, place_id INTO v_restaurant_name, v_place_id
  FROM public.menu_items
  WHERE item_id = p_item_id;

  IF v_restaurant_name IS NULL THEN
    RAISE EXCEPTION 'Menu item not found';
  END IF;

  SELECT owner_id INTO v_owner_id
  FROM public.restaurants
  WHERE CASE WHEN v_place_id IS NOT NULL
             THEN google_place_id = v_place_id
             ELSE lower(trim(name)) = lower(trim(v_restaurant_name)) END
  LIMIT 1;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to modify this menu item';
  END IF;

  IF public.is_franchise_chain(v_restaurant_name) THEN
    RAISE EXCEPTION 'This restaurant is part of a chain. Its menu is managed centrally and cannot be changed here.';
  END IF;

  UPDATE public.menu_items SET is_verified = FALSE WHERE item_id = p_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.unverify_menu_item(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_menu_item(p_item_id TEXT, p_force BOOLEAN DEFAULT FALSE)
RETURNS JSONB AS $$
DECLARE
  v_restaurant_name TEXT;
  v_place_id         TEXT;
  v_owner_id         UUID;
  v_affected_coupons JSONB;
BEGIN
  SELECT restaurant_name, place_id INTO v_restaurant_name, v_place_id
  FROM public.menu_items
  WHERE item_id = p_item_id;

  IF v_restaurant_name IS NULL THEN
    RAISE EXCEPTION 'Menu item not found';
  END IF;

  SELECT owner_id INTO v_owner_id
  FROM public.restaurants
  WHERE CASE WHEN v_place_id IS NOT NULL
             THEN google_place_id = v_place_id
             ELSE lower(trim(name)) = lower(trim(v_restaurant_name)) END
  LIMIT 1;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to modify this menu item';
  END IF;

  IF public.is_franchise_chain(v_restaurant_name) THEN
    RAISE EXCEPTION 'This restaurant is part of a chain. Its menu is managed centrally and cannot be changed here.';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id', id, 'couponCode', coupon_code))
  INTO v_affected_coupons
  FROM public.coupons
  WHERE menu_item_id = p_item_id
    AND is_deleted = false
    AND coupon_type IN ('item_percent', 'item_fixed');

  IF v_affected_coupons IS NOT NULL AND jsonb_array_length(v_affected_coupons) > 0 AND NOT p_force THEN
    RETURN jsonb_build_object('requiresConfirmation', true, 'affectedCoupons', v_affected_coupons);
  END IF;

  -- saved_menu_items.item_id cascades (030/034), so this is safe even if a
  -- consumer has this item saved.
  DELETE FROM public.menu_items WHERE item_id = p_item_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.delete_menu_item(TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_menu_item_out_of_stock(p_item_id TEXT, p_out_of_stock BOOLEAN)
RETURNS VOID AS $$
DECLARE
  v_restaurant_name TEXT;
  v_place_id        TEXT;
  v_owner_id        UUID;
BEGIN
  SELECT restaurant_name, place_id INTO v_restaurant_name, v_place_id
  FROM public.menu_items
  WHERE item_id = p_item_id;

  IF v_restaurant_name IS NULL THEN
    RAISE EXCEPTION 'Menu item not found';
  END IF;

  SELECT owner_id INTO v_owner_id
  FROM public.restaurants
  WHERE CASE WHEN v_place_id IS NOT NULL
             THEN google_place_id = v_place_id
             ELSE lower(trim(name)) = lower(trim(v_restaurant_name)) END
  LIMIT 1;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to modify this menu item';
  END IF;

  IF public.is_franchise_chain(v_restaurant_name) THEN
    RAISE EXCEPTION 'This restaurant is part of a chain. Its menu is managed centrally and cannot be changed here.';
  END IF;

  UPDATE public.menu_items SET is_out_of_stock = p_out_of_stock WHERE item_id = p_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.set_menu_item_out_of_stock(TEXT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

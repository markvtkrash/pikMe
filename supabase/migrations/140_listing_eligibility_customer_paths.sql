-- Listing eligibility (139) applied to every customer-facing path that reads a restaurant, so a restaurant that is not listed returns nothing
-- even when it is asked for by its ID. Each one calls restaurant_is_listed(place_id), the single rule.
--
--   get_saved_items                    a saved restaurant that is not listed is left out (its saved row is kept, so it comes back when it is
--                                      listed again). This replaces the closed / paused / deactivated-owner check of 066 with the same check
--                                      inside restaurant_is_listed, plus the new flag.
--   get_menu_items_for_restaurant      a place that is not listed has no menu. A call with no place (a name-only franchise lookup) is unchanged.
--   get_active_coupons_for_restaurant  a restaurant that is not listed has no coupons.
--   get_place_ids_with_active_coupons  a restaurant that is not listed is not in the Coupons Only list.
--   toggle_saved_restaurant            a restaurant that is not listed cannot be newly saved (un-saving always works).
--
-- While the master switch (app_config enforceListingEligibility) is off, the flag changes nothing. The older rules (a claimed restaurant an
-- admin closed, its owner paused, or whose owner was deactivated) were already applied to search and Saved; they now also apply to the
-- menu, the coupons and saving, which were reachable by ID before.
--
-- The two coupon functions have long bodies that other migrations own, so each is RENAMED to _<name>_raw and a thin function with the original
-- name and signature checks the rule and then calls the raw one. The raw one keeps the real body. If a LATER migration redefines
-- get_active_coupons_for_restaurant or get_place_ids_with_active_coupons with CREATE OR REPLACE, it replaces the check: redefine the _raw one
-- instead. Safe to re-run as long as that has not happened.

-- ── 1. Saved items ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_saved_items()
RETURNS JSONB AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  RETURN jsonb_build_object(
    'restaurants', COALESCE(
      (SELECT jsonb_agg(row_to_json(r.*) ORDER BY sr.saved_at DESC)
       FROM public.saved_restaurants sr
       LEFT JOIN public.cached_restaurants r ON r.place_id = sr.place_id
       WHERE sr.user_id = v_user_id
         AND public.restaurant_is_listed(sr.place_id)),
      '[]'::JSONB
    ),
    'menuItems', COALESCE(
      (SELECT jsonb_agg(row_to_json(m.*) ORDER BY sm.saved_at DESC)
       FROM public.saved_menu_items sm
       LEFT JOIN public.menu_items m ON m.item_id = sm.item_id
       WHERE sm.user_id = v_user_id),
      '[]'::JSONB
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. A restaurant's menu ─────────────────────────────────────────────────
-- Same as 103, plus the check at the top.
CREATE OR REPLACE FUNCTION public.get_menu_items_for_restaurant(
  p_place_id TEXT,
  p_restaurant_name TEXT
)
RETURNS SETOF public.menu_items
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_chain_name TEXT;
BEGIN
  -- a restaurant that is not listed has no menu for customers
  IF NOT public.restaurant_is_listed(p_place_id) THEN
    RETURN;
  END IF;

  -- 1. the place's own items (the whole menu of that one location)
  IF p_place_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.menu_items mi WHERE mi.place_id = p_place_id
  ) THEN
    RETURN QUERY
    SELECT mi.*
    FROM public.menu_items mi
    WHERE mi.place_id = p_place_id
      AND mi.is_out_of_stock = FALSE;
    RETURN;
  END IF;

  -- 2. a franchise shares one chain menu; an independent has nothing without items of its own
  SELECT c.name INTO v_chain_name FROM public.find_franchise_chain(p_restaurant_name) c;
  IF v_chain_name IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.place_id IS NULL AND mi.restaurant_name = p_restaurant_name
  ) THEN
    p_restaurant_name := v_chain_name;
  END IF;

  RETURN QUERY
  SELECT mi.*
  FROM public.menu_items mi
  WHERE mi.place_id IS NULL
    AND mi.restaurant_name = p_restaurant_name
    AND mi.is_out_of_stock = FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_items_for_restaurant(TEXT, TEXT) TO anon, authenticated;

-- ── 3. A restaurant's coupons ──────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public._get_active_coupons_for_restaurant_raw(uuid)') IS NULL THEN
    ALTER FUNCTION public.get_active_coupons_for_restaurant(uuid) RENAME TO _get_active_coupons_for_restaurant_raw;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._get_active_coupons_for_restaurant_raw(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._get_active_coupons_for_restaurant_raw(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_active_coupons_for_restaurant(p_restaurant_id UUID)
RETURNS TABLE (
  id UUID,
  restaurant_id UUID,
  coupon_code TEXT,
  coupon_type TEXT,
  discount_value NUMERIC,
  menu_item_id TEXT,
  is_active BOOLEAN,
  expiry_date TIMESTAMP WITH TIME ZONE,
  usage_limit INTEGER,
  times_used INTEGER,
  per_user_limit INTEGER,
  user_uses_count INTEGER,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  activated_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.restaurant_is_listed(
    (SELECT r.google_place_id FROM public.restaurants r WHERE r.id = p_restaurant_id)
  ) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public._get_active_coupons_for_restaurant_raw(p_restaurant_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_coupons_for_restaurant(UUID) TO authenticated;

-- ── 4. The Coupons Only list ───────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public._get_place_ids_with_active_coupons_raw()') IS NULL THEN
    ALTER FUNCTION public.get_place_ids_with_active_coupons() RENAME TO _get_place_ids_with_active_coupons_raw;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._get_place_ids_with_active_coupons_raw() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._get_place_ids_with_active_coupons_raw() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_place_ids_with_active_coupons()
RETURNS TABLE (google_place_id TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  SELECT t.google_place_id
  FROM public._get_place_ids_with_active_coupons_raw() t
  WHERE public.restaurant_is_listed(t.google_place_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_place_ids_with_active_coupons() TO authenticated;

-- ── 5. Saving a restaurant ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.toggle_saved_restaurant(p_place_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  IF EXISTS (SELECT 1 FROM public.saved_restaurants WHERE user_id = v_user_id AND place_id = p_place_id) THEN
    DELETE FROM public.saved_restaurants WHERE user_id = v_user_id AND place_id = p_place_id;
    RETURN FALSE;
  ELSE
    -- a restaurant that is not listed cannot be newly saved
    IF NOT public.restaurant_is_listed(p_place_id) THEN
      RETURN FALSE;
    END IF;
    INSERT INTO public.saved_restaurants (user_id, place_id) VALUES (v_user_id, p_place_id);
    RETURN TRUE;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';

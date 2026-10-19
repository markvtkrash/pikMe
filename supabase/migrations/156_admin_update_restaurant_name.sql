-- Admin's Manage Restaurants screen has no way to fix a claimed restaurant's name (e.g. a typo
-- carried over from Google, or an owner's own typo at claim time) -- every write path to
-- public.restaurants (admin_set_restaurant_status, admin_set_restaurant_categories,
-- owner_set_restaurant_paused, etc.) updates something else, never `name`. This adds that one
-- missing admin-only RPC, matching the _require_admin() guard the other admin_* functions use.

CREATE OR REPLACE FUNCTION public.admin_update_restaurant_name(p_restaurant_id UUID, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := btrim(p_name);
BEGIN
  PERFORM public._require_admin();
  IF v_name = '' OR v_name IS NULL THEN
    RAISE EXCEPTION 'Restaurant name cannot be empty';
  END IF;
  UPDATE public.restaurants r SET name = v_name, updated_at = NOW() WHERE r.id = p_restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_restaurant_name(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_restaurant_name(UUID, TEXT) TO authenticated;

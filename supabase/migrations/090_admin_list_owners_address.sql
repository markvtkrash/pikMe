-- Manage Restaurants: show each restaurant's street address. admin_list_owners (083)
-- returns one row per owner with their restaurant; this adds restaurants.address as the
-- last column and changes nothing else: same admin-only check, same join, same
-- ordering. The return shape gains a column, so the old function is dropped first.
-- Safe to re-run.
DROP FUNCTION IF EXISTS public.admin_list_owners();

CREATE FUNCTION public.admin_list_owners()
RETURNS TABLE (
  owner_id UUID,
  business_name TEXT,
  email TEXT,
  is_active BOOLEAN,
  restaurant_id UUID,
  restaurant_name TEXT,
  restaurant_status TEXT,
  claimed_at TIMESTAMP WITH TIME ZONE,
  google_place_id TEXT,
  restaurant_address TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can list owners';
  END IF;

  RETURN QUERY
  SELECT
    ro.id,
    ro.business_name,
    ro.email,
    ro.is_active,
    r.id,
    r.name,
    r.status,
    r.claimed_at,
    r.google_place_id,
    r.address
  FROM public.restaurant_owners ro
  LEFT JOIN public.restaurants r ON r.owner_id = ro.id
  ORDER BY ro.business_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_owners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_owners() TO authenticated;

NOTIFY pgrst, 'reload schema';

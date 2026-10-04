-- Adds the owner's restaurant (name + address) to list_all_users() so the admin
-- "All Users" page can show where each restaurant owner's restaurant is.
-- NULL for customers and admins, and for an owner who hasn't claimed anything yet.
--
-- An owner can technically have more than one restaurant row (nothing in the
-- schema prevents it); this shows the MOST RECENT claim, the same one the owner
-- app uses.
--
-- Everything else is identical to the 058 version (admin-only, same ordering).
-- RETURNS TABLE can't gain columns in place, so the old function is dropped first.
DROP FUNCTION IF EXISTS public.list_all_users();

CREATE OR REPLACE FUNCTION public.list_all_users()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  role TEXT,
  business_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  last_sign_in_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN,
  restaurant_name TEXT,
  restaurant_address TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can list users';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::TEXT,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = u.id AND ur.role = 'admin'
      ) THEN 'admin'
      WHEN ro.id IS NOT NULL THEN 'owner'
      ELSE 'customer'
    END AS role,
    ro.business_name,
    u.created_at,
    u.last_sign_in_at,
    ro.is_active,
    rest.name::TEXT,
    rest.address::TEXT
  FROM auth.users u
  LEFT JOIN public.restaurant_owners ro ON ro.id = u.id
  LEFT JOIN LATERAL (
    SELECT r.name, r.address
    FROM public.restaurants r
    WHERE r.owner_id = u.id
    ORDER BY r.claimed_at DESC NULLS LAST
    LIMIT 1
  ) rest ON true
  ORDER BY u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_all_users TO authenticated;

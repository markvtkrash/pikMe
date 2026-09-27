-- Adds is_active to list_all_users() so the admin "All Users" page can show
-- and toggle an owner's login-blocked state directly from that list, instead
-- of only from the separate Manage Owners page. NULL for non-owner rows
-- (customers/admins have no is_active concept — only restaurant_owners does).
-- Reuses the existing admin_set_owner_active RPC (042_owner_management.sql)
-- for the actual toggle and its login-time enforcement
-- (restaurant-auth-login already rejects sign-in when is_active = false) —
-- this migration only changes what's returned for display.
--
-- Postgres won't let CREATE OR REPLACE change a function's return columns
-- (RETURNS TABLE is implemented as OUT parameters, and those can't be added
-- to in place) — the old 6-column version has to be dropped first.
DROP FUNCTION IF EXISTS public.list_all_users();

CREATE OR REPLACE FUNCTION public.list_all_users()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  role TEXT,
  business_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  last_sign_in_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN
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
    ro.is_active
  FROM auth.users u
  LEFT JOIN public.restaurant_owners ro ON ro.id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_all_users TO authenticated;

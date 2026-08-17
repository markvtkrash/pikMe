-- Migration: 025_admin_list_users
-- Purpose: RPC for the admin dashboard's Users list. auth.users isn't exposed
-- to PostgREST directly, so this SECURITY DEFINER function reads it
-- server-side (after checking the caller is an admin) and joins in the
-- role/business info kept in the public schema.
-- Date: 2026-08-16

CREATE OR REPLACE FUNCTION public.list_all_users()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  role TEXT,
  business_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  last_sign_in_at TIMESTAMP WITH TIME ZONE
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
    u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.restaurant_owners ro ON ro.id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_all_users TO authenticated;

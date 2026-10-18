-- Fixes a real gap left in migration 005: admin_get_all_agreements() was granted to
-- `authenticated` with NO admin check inside it at all -- unlike every other admin_* function in
-- this codebase (which all call _require_admin()). As it stood, any signed-in customer could call
-- it directly and read every user's consent history, including their email, IP address and user
-- agent. The 005 comment even says so ("this allows anyone to execute it") without treating that
-- as a problem to fix.
--
-- Also adds email (joined from auth.users, same pattern as list_all_users) so an admin report
-- can show who agreed, not just a bare user_id. RETURNS TABLE can't gain a column in place, so
-- the old function is dropped first.
DROP FUNCTION IF EXISTS public.admin_get_all_agreements();

CREATE OR REPLACE FUNCTION public.admin_get_all_agreements()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  agreement_type TEXT,
  version TEXT,
  agreed_at TIMESTAMP WITH TIME ZONE,
  ip_address INET,
  user_agent TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    ua.user_id,
    u.email::TEXT,
    ua.agreement_type,
    ua.version,
    ua.agreed_at,
    ua.ip_address,
    ua.user_agent
  FROM public.user_agreements ua
  JOIN auth.users u ON u.id = ua.user_id
  ORDER BY ua.agreed_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_all_agreements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_all_agreements() TO authenticated;

NOTIFY pgrst, 'reload schema';

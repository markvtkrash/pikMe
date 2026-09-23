-- Migration: 042_owner_management
-- Purpose: Admin owner-management features — deactivate owner logins,
--          mark a restaurant closed (out of business) without deleting any
--          data, and fix the pending-claims count on the admin dashboard.
-- Date: 2026-09-21

-- ── 1. Owner active/inactive flag ────────────────────────────────────────────
ALTER TABLE public.restaurant_owners
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.restaurant_owners.is_active IS
  'false = admin-deactivated: owner cannot log in, but the account and all its restaurant/menu/coupon history is retained for auditing.';

-- ── 2. "closed" restaurant status (out of business, hidden from customers) ──
ALTER TABLE public.restaurants
DROP CONSTRAINT IF EXISTS valid_status;

ALTER TABLE public.restaurants
ADD CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'rejected', 'closed'));

COMMENT ON COLUMN public.restaurants.status IS
  'Restaurant claim/visibility status: pending, approved, rejected, or closed (out of business — hidden from customer search, data retained).';

-- ── 3. Admin RPC: activate/deactivate an owner's login ──────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_owner_active(p_owner_id UUID, p_is_active BOOLEAN)
RETURNS VOID
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
    RAISE EXCEPTION 'Only admins can change owner login status';
  END IF;

  UPDATE public.restaurant_owners
  SET is_active = p_is_active, updated_at = NOW()
  WHERE id = p_owner_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_owner_active TO authenticated;

-- ── 4. Admin RPC: toggle a restaurant between approved and closed ───────────
-- Deliberately does not touch pending/rejected restaurants -- those go
-- through approve_restaurant_claim / reject_restaurant_claim instead.
CREATE OR REPLACE FUNCTION public.admin_set_restaurant_status(p_restaurant_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_current_status TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can change restaurant status';
  END IF;

  IF p_status NOT IN ('approved', 'closed') THEN
    RAISE EXCEPTION 'admin_set_restaurant_status only supports approved/closed';
  END IF;

  SELECT status INTO v_current_status FROM public.restaurants WHERE id = p_restaurant_id;

  IF v_current_status NOT IN ('approved', 'closed') THEN
    RAISE EXCEPTION 'Restaurant must already be approved or closed to change between the two (current: %)', v_current_status;
  END IF;

  UPDATE public.restaurants
  SET status = p_status, updated_at = NOW()
  WHERE id = p_restaurant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_restaurant_status TO authenticated;

-- ── 5. Admin RPC: list owners with their restaurant, for the Manage Owners page ──
CREATE OR REPLACE FUNCTION public.admin_list_owners()
RETURNS TABLE (
  owner_id UUID,
  business_name TEXT,
  email TEXT,
  is_active BOOLEAN,
  restaurant_id UUID,
  restaurant_name TEXT,
  restaurant_status TEXT,
  claimed_at TIMESTAMP WITH TIME ZONE
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
    r.claimed_at
  FROM public.restaurant_owners ro
  LEFT JOIN public.restaurants r ON r.owner_id = ro.id
  ORDER BY ro.business_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_owners TO authenticated;

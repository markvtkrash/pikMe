-- Cleaning up owner logins that have no restaurant: flag, then deactivate, then delete.
--
--   restaurant_owners.deactivated_at   when an admin deactivated the login (NULL while active). Set by admin_set_owner_active.
--   _owner_removal_state()             every owner with NO restaurant, and whether the login may be deleted yet. A login may be
--                                      deleted only when ALL of these hold:
--                                        - it has no restaurant (any status),
--                                        - it was deactivated at least ownerDeleteWaitDays ago (app_config, default 30),
--                                        - it has no open or in-progress support ticket.
--                                      Resolved/closed tickets do not block, but they are deleted with the account (counted so the
--                                      admin is told).
--   admin_list_removable_owners()      that list for the admin page. Admin only.
--   admin_deactivate_owners(ids)       deactivates up to 200 active owners that have no restaurant, in one step. Admin only.
--   owner_delete_check(ids)            the same rules, re-checked by the delete edge function just before it deletes. Server only.
--
-- Safe to re-run.

ALTER TABLE public.restaurant_owners ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- Owners already deactivated: use the last time their record changed as the best known date.
UPDATE public.restaurant_owners SET deactivated_at = updated_at WHERE is_active = FALSE AND deactivated_at IS NULL;

INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('ownerDeleteWaitDays', '30', 'Admin: days an owner login with no restaurant must stay deactivated before it can be deleted.', 'Admin app: no .env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description, env_var_name = EXCLUDED.env_var_name;

-- Deactivating records the date; reactivating clears it.
CREATE OR REPLACE FUNCTION public.admin_set_owner_active(p_owner_id UUID, p_is_active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  UPDATE public.restaurant_owners
     SET is_active = p_is_active,
         deactivated_at = CASE WHEN p_is_active THEN NULL ELSE COALESCE(deactivated_at, NOW()) END,
         updated_at = NOW()
   WHERE id = p_owner_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_owner_active(UUID, BOOLEAN) TO authenticated;

-- ── The rules, in one place ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._owner_removal_state()
RETURNS TABLE (
  owner_id UUID, business_name TEXT, email TEXT, is_active BOOLEAN, deactivated_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
  open_tickets INTEGER, resolved_tickets INTEGER, can_delete BOOLEAN, days_left INTEGER, reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH w AS (SELECT public._menu_setting('ownerDeleteWaitDays', 30, 0, 365) AS wait_days),
  base AS (
    SELECT
      ro.id, ro.business_name, ro.email, ro.is_active, ro.deactivated_at, ro.created_at,
      (SELECT COUNT(*)::INTEGER FROM public.support_tickets t WHERE t.owner_id = ro.id AND t.status IN ('open', 'in_progress')) AS open_t,
      (SELECT COUNT(*)::INTEGER FROM public.support_tickets t WHERE t.owner_id = ro.id AND t.status IN ('resolved', 'closed')) AS done_t,
      CASE WHEN ro.is_active OR ro.deactivated_at IS NULL THEN NULL
           ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (ro.deactivated_at + make_interval(days => (SELECT wait_days FROM w)) - NOW())) / 86400))::INTEGER
      END AS left_days
    FROM public.restaurant_owners ro
    WHERE NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r.owner_id = ro.id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = ro.id AND ur.role = 'admin')
  )
  SELECT
    b.id, b.business_name, b.email, b.is_active, b.deactivated_at, b.created_at, b.open_t, b.done_t,
    (NOT b.is_active AND b.open_t = 0 AND COALESCE(b.left_days, 1) = 0),
    b.left_days,
    CASE
      WHEN b.is_active THEN 'Deactivate it first'
      WHEN b.open_t > 0 THEN b.open_t::TEXT || ' open support ticket' || CASE WHEN b.open_t = 1 THEN '' ELSE 's' END
      WHEN COALESCE(b.left_days, 1) > 0 THEN 'Can be deleted in ' || b.left_days::TEXT || ' day' || CASE WHEN b.left_days = 1 THEN '' ELSE 's' END
      ELSE NULL
    END
  FROM base b;
$$;

REVOKE ALL ON FUNCTION public._owner_removal_state() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_removable_owners()
RETURNS TABLE (
  owner_id UUID, business_name TEXT, email TEXT, is_active BOOLEAN, deactivated_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
  open_tickets INTEGER, resolved_tickets INTEGER, can_delete BOOLEAN, days_left INTEGER, reason TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY SELECT * FROM public._owner_removal_state() ORDER BY business_name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_removable_owners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_removable_owners() TO authenticated;

-- Deactivates the active owners in the list that have no restaurant. Others are left alone. Returns how many changed.
CREATE OR REPLACE FUNCTION public.admin_deactivate_owners(p_owner_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  PERFORM public._require_admin();
  IF p_owner_ids IS NULL OR cardinality(p_owner_ids) = 0 THEN RETURN 0; END IF;
  IF cardinality(p_owner_ids) > 200 THEN RAISE EXCEPTION 'Deactivate at most 200 owners at a time'; END IF;

  UPDATE public.restaurant_owners ro
     SET is_active = FALSE, deactivated_at = NOW(), updated_at = NOW()
   WHERE ro.id = ANY(p_owner_ids)
     AND ro.is_active
     AND ro.id IN (SELECT s.owner_id FROM public._owner_removal_state() s);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_deactivate_owners(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_owners(UUID[]) TO authenticated;

-- Used by the delete edge function (service role) right before it deletes: which of these owners may go, and why not for the rest.
CREATE OR REPLACE FUNCTION public.owner_delete_check(p_owner_ids UUID[])
RETURNS TABLE (owner_id UUID, email TEXT, can_delete BOOLEAN, reason TEXT, resolved_tickets INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id,
         s.email,
         COALESCE(s.can_delete, FALSE),
         CASE WHEN s.owner_id IS NULL THEN 'Not an owner without a restaurant (it may have one now)' ELSE s.reason END,
         COALESCE(s.resolved_tickets, 0)
  FROM unnest(p_owner_ids) AS i(id)
  LEFT JOIN public._owner_removal_state() s ON s.owner_id = i.id;
$$;

REVOKE ALL ON FUNCTION public.owner_delete_check(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_delete_check(UUID[]) TO service_role;

NOTIFY pgrst, 'reload schema';

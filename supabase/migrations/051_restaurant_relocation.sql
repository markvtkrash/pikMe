-- Migration: 051_restaurant_relocation
-- Purpose: "My restaurant moved" flow (Case 2 from the address-change
--          design). An owner submits a relocation request pointing at a new
--          Google listing (found via the same search UI used to claim in
--          the first place); an admin reviews old vs. new and approves or
--          rejects. Two gates cap how often this can be invoked at all,
--          instead of rate-limiting individual searches within one attempt:
--          only one pending request per restaurant at a time, and a cooldown
--          after a request is resolved before another can be submitted.
-- Date: 2026-09-22

CREATE TABLE IF NOT EXISTS public.restaurant_relocation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.restaurant_owners(id) ON DELETE CASCADE,
  old_google_place_id TEXT NOT NULL,
  old_name TEXT NOT NULL,
  old_address TEXT NOT NULL,
  new_google_place_id TEXT NOT NULL,
  new_name TEXT NOT NULL,
  new_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMP WITH TIME ZONE,
  decided_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_relocation_requests_restaurant ON public.restaurant_relocation_requests(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_relocation_requests_status ON public.restaurant_relocation_requests(status);

ALTER TABLE public.restaurant_relocation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own relocation requests"
  ON public.restaurant_relocation_requests
  FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Service role full access"
  ON public.restaurant_relocation_requests
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.restaurant_relocation_requests IS
  'Owner-submitted "my restaurant moved to a new Google listing" requests, admin-approved before the claim is re-pointed.';

-- Cooldown clock -- set whenever a request is resolved (approved or
-- rejected), independent of restaurants.claimed_at.
ALTER TABLE public.restaurants
ADD COLUMN IF NOT EXISTS last_relocation_decision_at TIMESTAMP WITH TIME ZONE;

-- ── Owner: submit a relocation request ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_restaurant_relocation(
  p_restaurant_id UUID,
  p_new_google_place_id TEXT,
  p_new_name TEXT,
  p_new_address TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_restaurant RECORD;
  v_pending_count INTEGER;
  v_cooldown_days CONSTANT INTEGER := 30;
  v_new_id UUID;
BEGIN
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id;

  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  IF v_restaurant.owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to relocate this restaurant';
  END IF;

  -- Gate 1: only one pending request at a time.
  SELECT COUNT(*) INTO v_pending_count
  FROM public.restaurant_relocation_requests
  WHERE restaurant_id = p_restaurant_id AND status = 'pending';

  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'A relocation request is already pending review';
  END IF;

  -- Gate 2: cooldown after the last resolved request.
  IF v_restaurant.last_relocation_decision_at IS NOT NULL
     AND v_restaurant.last_relocation_decision_at > NOW() - (v_cooldown_days * INTERVAL '1 day') THEN
    RAISE EXCEPTION 'You can request another relocation after %',
      to_char(v_restaurant.last_relocation_decision_at + (v_cooldown_days * INTERVAL '1 day'), 'YYYY-MM-DD');
  END IF;

  INSERT INTO public.restaurant_relocation_requests (
    restaurant_id, owner_id,
    old_google_place_id, old_name, old_address,
    new_google_place_id, new_name, new_address
  )
  VALUES (
    p_restaurant_id, auth.uid(),
    v_restaurant.google_place_id, v_restaurant.name, v_restaurant.address,
    p_new_google_place_id, p_new_name, p_new_address
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_restaurant_relocation TO authenticated;

-- ── Owner: check whether they're currently allowed to open the search screen ──
CREATE OR REPLACE FUNCTION public.get_relocation_eligibility(p_restaurant_id UUID)
RETURNS TABLE (eligible BOOLEAN, reason TEXT, retry_after TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_restaurant RECORD;
  v_pending_count INTEGER;
  v_cooldown_days CONSTANT INTEGER := 30;
  v_retry_after TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id;

  IF v_restaurant IS NULL OR v_restaurant.owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COUNT(*) INTO v_pending_count
  FROM public.restaurant_relocation_requests
  WHERE restaurant_id = p_restaurant_id AND status = 'pending';

  IF v_pending_count > 0 THEN
    RETURN QUERY SELECT false, 'pending_request'::TEXT, NULL::TIMESTAMP WITH TIME ZONE;
    RETURN;
  END IF;

  IF v_restaurant.last_relocation_decision_at IS NOT NULL THEN
    v_retry_after := v_restaurant.last_relocation_decision_at + (v_cooldown_days * INTERVAL '1 day');
    IF v_retry_after > NOW() THEN
      RETURN QUERY SELECT false, 'cooldown'::TEXT, v_retry_after;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMP WITH TIME ZONE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_relocation_eligibility TO authenticated;

-- ── Admin: list pending relocation requests ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_relocation_requests()
RETURNS TABLE (
  id UUID,
  restaurant_id UUID,
  business_name TEXT,
  owner_email TEXT,
  old_name TEXT,
  old_address TEXT,
  new_name TEXT,
  new_address TEXT,
  requested_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    rr.id, rr.restaurant_id, ro.business_name, ro.email,
    rr.old_name, rr.old_address, rr.new_name, rr.new_address, rr.requested_at
  FROM public.restaurant_relocation_requests rr
  JOIN public.restaurant_owners ro ON ro.id = rr.owner_id
  WHERE rr.status = 'pending'
  ORDER BY rr.requested_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_relocation_requests TO authenticated;

-- ── Admin: reject (no Google call needed -- approval goes through an edge
--    function instead, since it needs to re-fetch and re-cache from Google) ──
CREATE OR REPLACE FUNCTION public.admin_reject_relocation_request(p_request_id UUID, p_admin_note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_restaurant_id UUID;
BEGIN
  PERFORM public._require_admin();

  UPDATE public.restaurant_relocation_requests
  SET status = 'rejected', admin_note = p_admin_note, decided_at = NOW(), decided_by = auth.uid()
  WHERE id = p_request_id AND status = 'pending'
  RETURNING restaurant_id INTO v_restaurant_id;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Relocation request not found or already decided';
  END IF;

  UPDATE public.restaurants SET last_relocation_decision_at = NOW() WHERE id = v_restaurant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reject_relocation_request TO authenticated;

-- Migration: 052_restaurant_pause_toggle
-- Purpose: Owner-tool #4 -- a self-service "temporarily closed" toggle,
--          distinct from the admin-only permanent "closed" status (046).
--          Reversible, no admin approval needed, for short-term situations
--          (holiday, emergency) where waiting on a review would defeat the
--          purpose. A separate boolean instead of overloading `status`,
--          since status is an admin-controlled dimension (pending/approved/
--          rejected/closed) and this is an independent, owner-controlled one.
-- Date: 2026-09-22

ALTER TABLE public.restaurants
ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.restaurants.is_paused IS
  'Owner-controlled, reversible "temporarily closed" flag -- hidden from customer search while true. Distinct from status=closed (admin-only, permanent, out-of-business).';

CREATE OR REPLACE FUNCTION public.owner_set_restaurant_paused(p_restaurant_id UUID, p_paused BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.restaurants WHERE id = p_restaurant_id;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to manage this restaurant';
  END IF;

  UPDATE public.restaurants
  SET is_paused = p_paused,
      paused_at = CASE WHEN p_paused THEN NOW() ELSE NULL END,
      updated_at = NOW()
  WHERE id = p_restaurant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_set_restaurant_paused TO authenticated;

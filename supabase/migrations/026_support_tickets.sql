-- Migration: 026_support_tickets
-- Purpose: Restaurant-owner support tickets, visible/manageable by admins.
-- Date: 2026-08-17

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.restaurant_owners(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  owner_seen_resolution BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT valid_ticket_status CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_owner_id ON public.support_tickets(owner_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- Owners can view and create their own tickets.
CREATE POLICY "Owners can view own tickets"
  ON public.support_tickets
  FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Owners can create own tickets"
  ON public.support_tickets
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Admins can view every ticket. Updates (status/resolution) go through the
-- admin_update_ticket() RPC below rather than a raw UPDATE policy, so the
-- allowed status values and resolved_at/owner_seen_resolution bookkeeping
-- stay centralized in one place.
CREATE POLICY "Admins can view all tickets"
  ON public.support_tickets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

COMMENT ON TABLE public.support_tickets IS 'Support tickets raised by restaurant owners from their dashboard, resolved by admins.';

GRANT SELECT, INSERT ON public.support_tickets TO authenticated;

-- RPC: owner dismisses a resolved ticket's banner. SECURITY DEFINER, but
-- scoped so it can only ever flip owner_seen_resolution on the caller's own
-- ticket — never status or resolution.
CREATE OR REPLACE FUNCTION public.mark_ticket_resolution_seen(p_ticket_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.support_tickets
  SET owner_seen_resolution = true
  WHERE id = p_ticket_id AND owner_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_ticket_resolution_seen TO authenticated;

-- RPC: admin sets a ticket's status + resolution text. Marking a ticket
-- resolved stamps resolved_at and resets owner_seen_resolution so the
-- dashboard banner reappears for the new resolution.
CREATE OR REPLACE FUNCTION public.admin_update_ticket(
  p_ticket_id UUID,
  p_status TEXT,
  p_resolution TEXT
)
RETURNS public.support_tickets
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_ticket public.support_tickets;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can update tickets';
  END IF;

  IF p_status NOT IN ('open', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  UPDATE public.support_tickets
  SET
    status = p_status,
    resolution = p_resolution,
    updated_at = NOW(),
    resolved_at = CASE WHEN p_status = 'resolved' THEN NOW() ELSE resolved_at END,
    owner_seen_resolution = CASE WHEN p_status = 'resolved' THEN false ELSE owner_seen_resolution END
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found: %', p_ticket_id;
  END IF;

  RETURN v_ticket;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_ticket TO authenticated;

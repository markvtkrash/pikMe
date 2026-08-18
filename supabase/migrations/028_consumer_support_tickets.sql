-- Migration: 028_consumer_support_tickets
-- Purpose: Let consumers (not just restaurant owners) submit support tickets
-- from the same table, differentiated by ticket_type. Generalizes the
-- submitter-tracking column name accordingly.
-- Date: 2026-08-18

ALTER TABLE public.support_tickets
  ALTER COLUMN restaurant_id DROP NOT NULL,
  ALTER COLUMN owner_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS consumer_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS ticket_type TEXT NOT NULL DEFAULT 'owner';

ALTER TABLE public.support_tickets
  RENAME COLUMN owner_seen_resolution TO submitter_seen_resolution;

ALTER TABLE public.support_tickets
  ADD CONSTRAINT valid_ticket_type CHECK (ticket_type IN ('owner', 'consumer'));

-- Keep each row internally consistent: an owner ticket must carry
-- restaurant/owner ids and no consumer id, and vice versa.
ALTER TABLE public.support_tickets
  ADD CONSTRAINT valid_ticket_submitter CHECK (
    (ticket_type = 'owner' AND owner_id IS NOT NULL AND restaurant_id IS NOT NULL AND consumer_id IS NULL)
    OR
    (ticket_type = 'consumer' AND consumer_id IS NOT NULL AND owner_id IS NULL AND restaurant_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_support_tickets_consumer_id ON public.support_tickets(consumer_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_type ON public.support_tickets(ticket_type);

-- Consumers can view and create their own tickets (owners already have the
-- equivalent policies from migration 026).
CREATE POLICY "Consumers can view own tickets"
  ON public.support_tickets
  FOR SELECT
  USING (consumer_id = auth.uid());

CREATE POLICY "Consumers can create own tickets"
  ON public.support_tickets
  FOR INSERT
  WITH CHECK (consumer_id = auth.uid() AND ticket_type = 'consumer');

-- Admins need to read user_profiles to see who filed a consumer ticket —
-- previously only self-reads were allowed.
CREATE POLICY "Admins can view all profiles"
  ON public.user_profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- Re-create mark_ticket_resolution_seen for both submitter types and the
-- renamed column.
CREATE OR REPLACE FUNCTION public.mark_ticket_resolution_seen(p_ticket_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.support_tickets
  SET submitter_seen_resolution = true
  WHERE id = p_ticket_id AND (owner_id = auth.uid() OR consumer_id = auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_ticket_resolution_seen TO authenticated;

-- Re-create admin_update_ticket to reset the renamed column.
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
    submitter_seen_resolution = CASE WHEN p_status = 'resolved' THEN false ELSE submitter_seen_resolution END
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found: %', p_ticket_id;
  END IF;

  RETURN v_ticket;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_ticket TO authenticated;

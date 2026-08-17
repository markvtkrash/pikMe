import { supabase } from './supabase';

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface SupportTicket {
  id: string;
  restaurant_id: string;
  owner_id: string;
  subject: string;
  message: string;
  status: TicketStatus;
  resolution: string | null;
  owner_seen_resolution: boolean;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export async function createSupportTicket(params: {
  restaurantId: string;
  ownerId: string;
  subject: string;
  message: string;
}): Promise<SupportTicket> {
  const { data, error } = await supabase
    .from('support_tickets')
    .insert({
      restaurant_id: params.restaurantId,
      owner_id: params.ownerId,
      subject: params.subject,
      message: params.message,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getMyTickets(): Promise<SupportTicket[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function markTicketResolutionSeen(ticketId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_ticket_resolution_seen', { p_ticket_id: ticketId });
  if (error) throw error;
}

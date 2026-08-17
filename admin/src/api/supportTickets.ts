import { supabase } from './supabase';

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface AdminSupportTicket {
  id: string;
  restaurant_id: string;
  owner_id: string;
  subject: string;
  message: string;
  status: TicketStatus;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  restaurants: { name: string } | null;
  restaurant_owners: { business_name: string; email: string } | null;
}

export async function getOpenTicketCount(): Promise<number> {
  const { count, error } = await supabase
    .from('support_tickets')
    .select('*', { count: 'exact', head: true })
    .in('status', ['open', 'in_progress']);

  if (error) throw error;
  return count || 0;
}

export async function getAllTickets(): Promise<AdminSupportTicket[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*, restaurants:restaurant_id(name), restaurant_owners:owner_id(business_name, email)')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as any) || [];
}

export async function getTicketById(id: string): Promise<AdminSupportTicket | null> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*, restaurants:restaurant_id(name), restaurant_owners:owner_id(business_name, email)')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data as any;
}

export async function adminUpdateTicket(
  ticketId: string,
  status: TicketStatus,
  resolution: string
): Promise<void> {
  const { error } = await supabase.rpc('admin_update_ticket', {
    p_ticket_id: ticketId,
    p_status: status,
    p_resolution: resolution || null,
  });
  if (error) throw error;
}

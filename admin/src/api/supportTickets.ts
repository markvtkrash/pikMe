import { supabase } from './supabase';

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketSubmitterType = 'owner' | 'consumer';

export interface AdminSupportTicket {
  id: string;
  ticket_type: TicketSubmitterType;
  restaurant_id: string | null;
  owner_id: string | null;
  consumer_id: string | null;
  subject: string;
  message: string;
  status: TicketStatus;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  restaurants: { name: string } | null;
  restaurant_owners: { business_name: string; email: string } | null;
  user_profiles: { display_name: string } | null;
}

export interface OpenTicketCounts {
  owner: number;
  consumer: number;
  total: number;
}

export async function getOpenTicketCounts(): Promise<OpenTicketCounts> {
  const { count: ownerCount, error: ownerError } = await supabase
    .from('support_tickets')
    .select('*', { count: 'exact', head: true })
    .in('status', ['open', 'in_progress'])
    .eq('ticket_type', 'owner');

  if (ownerError) throw ownerError;

  const { count: consumerCount, error: consumerError } = await supabase
    .from('support_tickets')
    .select('*', { count: 'exact', head: true })
    .in('status', ['open', 'in_progress'])
    .eq('ticket_type', 'consumer');

  if (consumerError) throw consumerError;

  const owner = ownerCount || 0;
  const consumer = consumerCount || 0;
  return { owner, consumer, total: owner + consumer };
}

const TICKET_SELECT = '*, restaurants:restaurant_id(name), restaurant_owners:owner_id(business_name, email), user_profiles:consumer_id(display_name)';

export async function getAllTickets(): Promise<AdminSupportTicket[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select(TICKET_SELECT)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as any) || [];
}

export async function getTicketById(id: string): Promise<AdminSupportTicket | null> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select(TICKET_SELECT)
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

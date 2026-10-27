import { supabase } from './supabase';

// One dish the menu agent found, waiting for (or past) an admin's decision (migration 160).
export interface AgentProposal {
  total_count: number;
  id: number;
  job_id: number;
  place_id: string;
  restaurant_name: string;
  item_name: string;
  description: string | null;
  price: number | null;
  source_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  merged_at: string | null;
  created_at: string;
}

export type ProposalStatus = AgentProposal['status'];

export async function listAgentProposals(status: ProposalStatus, limit = 50, offset = 0): Promise<AgentProposal[]> {
  const { data, error } = await supabase.rpc('admin_list_menu_agent_proposals', {
    p_status: status, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as AgentProposal[];
}

// Approves or rejects pending proposals. Resolves to how many changed (a decided one is left as it is).
export async function decideAgentProposals(ids: number[], approve: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('admin_decide_menu_agent_proposals', { p_ids: ids, p_approve: approve });
  if (error) throw error;
  return Number(data ?? 0);
}

// Adds the approved, not yet merged dishes of one restaurant to its menu. Nutrition is estimated by the AI in the
// menu-agent edge function; nothing is replaced or deleted.
export async function mergeApprovedProposals(placeId: string): Promise<{ added: number; confirmed: number; skipped: number }> {
  const { data, error } = await supabase.functions.invoke('menu-agent', { body: { action: 'merge', placeId } });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return { added: Number(data?.added ?? 0), confirmed: Number(data?.confirmed ?? 0), skipped: Number(data?.skipped ?? 0) };
}

import { supabase } from './supabase';
import { parseRegions, Region, REGION_SWITCH_KEY, RegionStatus } from '../utils/regions';

// Region launch control (migration 142). Admin only.
export async function listRegions(): Promise<Region[]> {
  const { data, error } = await supabase.rpc('admin_list_regions');
  if (error) throw error;
  return parseRegions(data);
}

// status 'live' and 'off' ignore goLiveAt; 'scheduled' needs it (an ISO time).
export async function setRegion(stateCode: string, status: RegionStatus, goLiveAt: string | null, note: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_region', {
    p_state_code: stateCode, p_status: status, p_go_live_at: status === 'scheduled' ? goLiveAt : null, p_note: note.trim() || null,
  });
  if (error) throw error;
}

// The emergency button: every state off. Returns how many were changed.
export async function turnOffAllRegions(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_turn_off_all_regions');
  if (error) throw error;
  return Number(data) || 0;
}

export async function getRegionWaitlist(stateCode: string): Promise<{ email: string; createdAt: string }[]> {
  const { data, error } = await supabase.rpc('admin_region_waitlist', { p_state_code: stateCode, p_limit: 1000 });
  if (error) throw error;
  return ((data ?? []) as { email: string; created_at: string }[]).map((r) => ({ email: r.email, createdAt: r.created_at }));
}

// The master switch lives in app_config; null when the row does not exist yet (migration 142 not run).
export async function getRegionGateValue(): Promise<string | null> {
  const { data, error } = await supabase.from('app_config').select('value').eq('key', REGION_SWITCH_KEY).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

export async function setRegionGateValue(value: 'true' | 'false'): Promise<void> {
  const { error } = await supabase.from('app_config').update({ value, updated_at: new Date().toISOString() }).eq('key', REGION_SWITCH_KEY);
  if (error) throw error;
}

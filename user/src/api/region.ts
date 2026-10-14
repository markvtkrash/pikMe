import { supabase } from './supabase';
import { parseRegionAccess, REGION_OPEN, RegionAccess } from '../utils/regionAccess';

// Is the state the customer is standing in open? (migration 142.) Any failure answers "open": a hiccup must never lock the customer out.
export async function getRegionAccess(latitude: number, longitude: number): Promise<RegionAccess> {
  try {
    const { data, error } = await supabase.functions.invoke('region-access', { body: { latitude, longitude } });
    if (error) throw error;
    return parseRegionAccess(data);
  } catch (e) {
    console.warn('[region] could not check the region, letting the customer in:', e instanceof Error ? e.message : e);
    return REGION_OPEN;
  }
}

export async function joinRegionWaitlist(email: string, country: string | null, state: string | null): Promise<void> {
  const { error } = await supabase.rpc('join_region_waitlist', { p_email: email.trim(), p_country: country ?? 'US', p_state: state ?? '' });
  if (error) throw new Error(error.message);
}

export async function leaveRegionWaitlist(country: string | null, state: string | null): Promise<void> {
  const { error } = await supabase.rpc('leave_region_waitlist', { p_country: country ?? 'US', p_state: state ?? '' });
  if (error) throw new Error(error.message);
}

// The signed-in customer's own email, to pre-fill the waitlist box (they can change it).
export async function getOwnEmail(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? '';
}

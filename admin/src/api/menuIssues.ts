import { supabase } from './supabase';
import type { PlaceMenuIssue } from '../utils/menuIssues';

// Independent restaurants whose menu could not be built automatically (migration 107), most-wanted first.
export async function getPlaceMenuIssues(): Promise<PlaceMenuIssue[]> {
  const { data, error } = await supabase.rpc('admin_list_place_menu_issues');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    job_id: Number(r.job_id),
    attempts: Number(r.attempts ?? 0),
    requested_count: Number(r.requested_count ?? 0),
    claimed: r.claimed === true,
  }));
}

// An admin's menu link for one restaurant: read as is, Google is not asked. Saving it puts the restaurant back in
// the queue; a blank link removes it.
export async function setPlaceOverrideLink(jobId: number, link: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_place_override_link', { p_job_id: jobId, p_link: link.trim() });
  if (error) throw error;
}

// Try the build again at the next run (clears the attempts).
export async function requeuePlaceBuild(jobId: number): Promise<void> {
  const { error } = await supabase.rpc('admin_requeue_place_build', { p_job_id: jobId });
  if (error) throw error;
}

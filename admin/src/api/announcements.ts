import { supabase } from './supabase';
import type { AnnouncementInput, AnnouncementRow } from '../utils/announcements';

// Every announcement, newest first, with its status (migration 128).
export async function listAnnouncements(): Promise<AnnouncementRow[]> {
  const { data, error } = await supabase.rpc('admin_list_announcements');
  if (error) throw error;
  return (data ?? []) as AnnouncementRow[];
}

// Creates an announcement (id null) or updates one. Resolves to its id.
export async function saveAnnouncement(id: string | null, input: AnnouncementInput): Promise<string> {
  const { data, error } = await supabase.rpc('admin_save_announcement', {
    p_id: id,
    p_audience: input.audience,
    p_title: input.title,
    p_message: input.message,
    p_kind: input.kind,
    p_link_label: input.linkLabel,
    p_link_url: input.linkUrl,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_min_app_version: input.minAppVersion,
    p_max_app_version: input.maxAppVersion,
  });
  if (error) throw error;
  return String(data);
}

// Ends a live announcement now (or cancels a scheduled one).
export async function endAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_end_announcement', { p_id: id });
  if (error) throw error;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_announcement', { p_id: id });
  if (error) throw error;
}

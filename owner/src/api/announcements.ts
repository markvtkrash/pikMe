import { supabase } from './supabase';
import { Announcement, parseAnnouncements } from '../utils/announcements';

// The live announcements for owners (migration 128), most important first, at most 3. A problem reading them (for example the
// database function is not installed yet) gives none, so this can never get in the owner's way.
export async function getOwnerAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await supabase.rpc('get_active_announcements', { p_audience: 'owner' });
  if (error) {
    console.warn('[announcements] could not load announcements:', error.message);
    return [];
  }
  return parseAnnouncements(data);
}

import { supabase } from './supabase';
import { PlaceMenuLink, toPlaceMenuLink } from '../utils/placeMenuLink';

// The link in force for a restaurant (by its Google place ID) and how its last read went, or null (migration 121).
export async function getPlaceMenuLink(placeId: string): Promise<PlaceMenuLink | null> {
  const { data, error } = await supabase.rpc('admin_get_place_menu_link', { p_place_id: placeId });
  if (error) throw error;
  return toPlaceMenuLink(data);
}

// Saves the admin's link (queued for the crawler), or removes it when blank. Resolves to 'queued' or 'removed'.
export async function setPlaceMenuLink(placeId: string, link: string): Promise<'queued' | 'removed'> {
  const { data, error } = await supabase.rpc('admin_set_place_menu_link', { p_place_id: placeId, p_link: link.trim() });
  if (error) throw error;
  return data === 'removed' ? 'removed' : 'queued';
}

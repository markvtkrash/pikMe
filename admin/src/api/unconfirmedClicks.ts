import { supabase } from './supabase';
import { toUnconfirmedPage, UnconfirmedClickedPage } from '../utils/unconfirmedClicks';

// A page of the restaurants customers opened that have no confirmed menu item, most opened first (migration 119).
export async function getUnconfirmedClickedRestaurants(limit: number, offset: number): Promise<UnconfirmedClickedPage> {
  const { data, error } = await supabase.rpc('admin_list_unconfirmed_clicked_restaurants', { p_limit: limit, p_offset: offset });
  if (error) throw error;
  return toUnconfirmedPage(data);
}

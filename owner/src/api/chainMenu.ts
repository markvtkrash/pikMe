import { supabase } from './supabase';
import { getRestaurantMenuItems } from './restaurantAuth';

// What owners of chain restaurants are told when they try to change the menu.
// Matches the message the database and edge functions return (migration 080).
export const CHAIN_MENU_MESSAGE =
  "Your restaurant is part of a chain, so its menu is managed centrally and can't be changed here. " +
  'If something on it is wrong, please contact support.';

// Is this restaurant a known franchise/chain (franchise_chains, migration 062)?
// The edit screens use it to explain instead of offering tools the server would
// refuse anyway. If the check fails the answer is false, so a lookup problem
// never locks a non-chain owner out of their own menu (the server still refuses
// chain edits regardless).
export async function isChainRestaurant(name: string): Promise<boolean> {
  const trimmed = name?.trim();
  if (!trimmed) return false;
  const { data, error } = await supabase.rpc('is_franchise_chain', { p_name: trimmed });
  if (error) {
    console.warn('[chainMenu] is_franchise_chain failed, treating as not a chain:', error.message);
    return false;
  }
  return data === true;
}

export interface OwnerViewMenuItem {
  id: string;
  item_id: string;
  name: string;
  calories: number | null;
  protein_g: number | null;
  is_verified: boolean;
  is_out_of_stock?: boolean;
}

// The menu customers see for a chain location: the shared chain menu (migration 086 makes the lookup find it
// under the chain's name even when this location's name differs), or the location's own items if it has any.
// Out-of-stock items are left out, as they are for customers.
export async function getChainMenuItems(name: string, placeId: string | null | undefined): Promise<OwnerViewMenuItem[]> {
  const { data, error } = await supabase.rpc('get_menu_items_for_restaurant', {
    p_place_id: placeId || null,
    p_restaurant_name: name.trim(),
  });
  if (error) throw error;
  return ((data ?? []) as any[])
    .map((row) => ({
      id: row.item_id,
      item_id: row.item_id,
      name: row.name,
      calories: row.calories ?? null,
      protein_g: row.protein_g ?? null,
      is_verified: row.is_verified === true,
      is_out_of_stock: row.is_out_of_stock === true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The items an owner sees on the Menu Management and Menu Items screens. A chain owner can only VIEW the
// chain menu (it is managed centrally), and sees what customers see. Everyone else sees their own items
// exactly as before. If the chain lookup fails (for example the database function is not installed yet),
// it falls back to the plain name lookup, so the screen never ends up empty because of it.
export async function getMenuItemsForOwnerView(
  restaurant: { name: string; google_place_id?: string | null },
): Promise<OwnerViewMenuItem[]> {
  if (await isChainRestaurant(restaurant.name)) {
    try {
      return await getChainMenuItems(restaurant.name, restaurant.google_place_id);
    } catch (e: any) {
      console.warn('[chainMenu] chain menu lookup failed, using the name lookup:', e?.message);
    }
  }
  return getRestaurantMenuItems(restaurant.name, restaurant.google_place_id);
}

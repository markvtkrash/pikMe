import { supabase } from './supabase';
import { fetchAllPages } from './reports';

export interface RestaurantMenuSummary {
  restaurant_name: string;
  address: string | null;
  source: 'claimed' | 'cached';
  restaurant_id: string | null;
  status: string | null;
  owner_business_name: string | null;
  owner_email: string | null;
  location_count: number;
  shares_menu_with_claimed: boolean;
  total_items: number;
  verified_items: number;
  unverified_items: number;
}

export interface AdminMenuItem {
  item_id: string;
  name: string;
  calories: number | null;
  protein_g: number | null;
  total_carbs_g: number | null;
  total_fat_g: number | null;
  saturated_fat_g: number | null;
  sodium_mg: number | null;
  is_verified: boolean;
  is_out_of_stock: boolean;
  nutrition_source: string | null;
}

// Every claimed + cached restaurant with its menu item counts (migration 065).
export function getRestaurantsWithMenuCounts(): Promise<RestaurantMenuSummary[]> {
  return fetchAllPages<RestaurantMenuSummary>('admin_list_restaurants_with_menu_counts');
}

export async function getRestaurantMenu(restaurantName: string): Promise<AdminMenuItem[]> {
  const { data, error } = await supabase.rpc('admin_get_restaurant_menu', { p_restaurant_name: restaurantName });
  if (error) throw error;
  return (data ?? []) as AdminMenuItem[];
}

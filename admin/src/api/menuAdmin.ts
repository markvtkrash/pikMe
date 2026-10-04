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

// ─── Manual Edit (migration 070) ─────────────────────────────────────────────

export interface EditableMenuItem {
  item_id: string;
  name: string;
  calories: number | null;
  protein_g: number | null;
  total_carbs_g: number | null;
  total_fat_g: number | null;
  saturated_fat_g: number | null;
  sodium_mg: number | null;
  dietary_fiber_g: number | null;
  sugars_g: number | null;
  serving_weight_grams: number | null;
  is_verified: boolean;
  is_out_of_stock: boolean;
  nutrition_source: string | null;
}

export async function getRestaurantMenuForEdit(restaurantName: string): Promise<EditableMenuItem[]> {
  const { data, error } = await supabase.rpc('admin_get_restaurant_menu_for_edit', {
    p_restaurant_name: restaurantName,
  });
  if (error) throw error;
  return (data ?? []) as EditableMenuItem[];
}

export interface MenuSharingInfo {
  cached_locations: number;
  claimed_locations: number;
}

// How many locations use this restaurant name (and therefore share its menu).
export async function getMenuSharingInfo(restaurantName: string): Promise<MenuSharingInfo> {
  const { data, error } = await supabase.rpc('admin_menu_sharing_info', {
    p_restaurant_name: restaurantName,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    cached_locations: Number(row?.cached_locations ?? 0),
    claimed_locations: Number(row?.claimed_locations ?? 0),
  };
}

export interface SaveMenuItemInput {
  restaurantName: string;
  // null/undefined = create a new item, otherwise update this one.
  itemId?: string | null;
  name: string;
  calories: number;
  protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  saturated_fat_g: number;
  sodium_mg: number;
  dietary_fiber_g: number;
  sugars_g: number;
  serving_weight_grams: number | null;
  is_verified: boolean;
  is_out_of_stock: boolean;
}

export async function saveMenuItem(input: SaveMenuItemInput): Promise<{ itemId: string; created: boolean }> {
  const { data, error } = await supabase.rpc('admin_save_menu_item', {
    p_restaurant_name: input.restaurantName,
    p_item_id: input.itemId ?? null,
    p_name: input.name,
    p_calories: input.calories,
    p_protein_g: input.protein_g,
    p_total_carbs_g: input.total_carbs_g,
    p_total_fat_g: input.total_fat_g,
    p_saturated_fat_g: input.saturated_fat_g,
    p_sodium_mg: input.sodium_mg,
    p_dietary_fiber_g: input.dietary_fiber_g,
    p_sugars_g: input.sugars_g,
    p_serving_weight_grams: input.serving_weight_grams,
    p_is_verified: input.is_verified,
    p_is_out_of_stock: input.is_out_of_stock,
  });
  if (error) throw error;
  return data as { itemId: string; created: boolean };
}

export interface DeleteMenuItemsResult {
  items: number;
  coupons: number;
  savedCopies: number;
  deleted: boolean;
}

// What deleting these items would do (nothing is deleted) — for the confirmation dialog.
export async function previewDeleteMenuItems(itemIds: string[]): Promise<DeleteMenuItemsResult> {
  const { data, error } = await supabase.rpc('admin_delete_menu_items', {
    p_item_ids: itemIds,
    p_dry_run: true,
  });
  if (error) throw error;
  return data as DeleteMenuItemsResult;
}

export async function deleteMenuItems(itemIds: string[]): Promise<DeleteMenuItemsResult> {
  const { data, error } = await supabase.rpc('admin_delete_menu_items', {
    p_item_ids: itemIds,
    p_dry_run: false,
  });
  if (error) throw error;
  return data as DeleteMenuItemsResult;
}

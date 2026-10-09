import { supabase } from './supabase';
import {
  AdminCategory, CategoryGroup, CategoryMapping, parseAdminCategories, parseRestaurantCategories, RestaurantCategoriesFromServer,
} from '../utils/categories';

// Every category (also the switched-off ones) and every Google mapping, for the Restaurant Categories page (migration 129).
export async function getAdminCategories(): Promise<{ categories: AdminCategory[]; mappings: CategoryMapping[] }> {
  const { data, error } = await supabase.rpc('admin_list_restaurant_categories');
  if (error) throw error;
  return parseAdminCategories(data);
}

// Adds a category, or changes its name, order or on/off switch.
export async function saveAdminCategory(input: { key: string; grp: CategoryGroup; label: string; sortOrder: number; isActive: boolean }): Promise<void> {
  const { error } = await supabase.rpc('admin_save_restaurant_category', {
    p_key: input.key, p_grp: input.grp, p_label: input.label, p_sort_order: input.sortOrder, p_is_active: input.isActive,
  });
  if (error) throw error;
}

// Maps (enabled) or unmaps a Google place type for a category.
export async function setCategoryMapping(googleType: string, categoryKey: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_category_mapping', {
    p_google_type: googleType, p_category_key: categoryKey, p_enabled: enabled,
  });
  if (error) throw error;
}

// One restaurant: the owner's choices, Google's types and Google's guess.
export async function getRestaurantCategoriesForAdmin(restaurantId: string): Promise<RestaurantCategoriesFromServer> {
  const { data, error } = await supabase.rpc('admin_get_restaurant_categories', { p_restaurant_id: restaurantId });
  if (error) throw error;
  return parseRestaurantCategories(data);
}

// Saves a restaurant's categories. A null list puts that group back on Google's guess.
export async function setRestaurantCategoriesAsAdmin(
  restaurantId: string, value: { venueTypes: string[] | null; services: string[] | null; cuisines: string[] | null }
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_restaurant_categories', {
    p_restaurant_id: restaurantId, p_venue_types: value.venueTypes, p_services: value.services, p_cuisines: value.cuisines,
  });
  if (error) throw error;
}

import { supabase } from './supabase';
import type { MenuItem } from '../types';

// Converts a menu_items DB row into the app's MenuItem shape.
export function mapMenuRow(item: any): MenuItem {
  return {
    itemId: item.item_id,
    name: item.name,
    restaurantName: item.restaurant_name,
    nutrition: {
      calories: item.calories,
      totalFat_g: item.total_fat_g,
      saturatedFat_g: item.saturated_fat_g,
      sodium_mg: item.sodium_mg,
      totalCarbs_g: item.total_carbs_g,
      dietaryFiber_g: item.dietary_fiber_g ?? 0,
      sugars_g: item.sugars_g ?? 0,
      protein_g: item.protein_g,
      servingWeightGrams: item.serving_weight_grams,
    },
    imageUrl: item.image_url,
    isVerified: item.is_verified,
    nutritionSource: item.nutrition_source,
  };
}

// The in-stock menu items already stored for a restaurant — the location's
// own menu if it has one, otherwise the shared name-keyed template (decided in
// SQL by get_menu_items_for_restaurant, migration 067). Returns [] when there
// is nothing stored, so the caller can fall back to the AI pull.
//
// If that function isn't installed yet (migration 067 not applied) or errors,
// this falls back to the original direct name lookup, so the app keeps
// working exactly as before while the database catches up.
export async function fetchStoredMenuItems(restaurant: { placeId: string; name: string }): Promise<MenuItem[]> {
  const { data, error } = await supabase.rpc('get_menu_items_for_restaurant', {
    p_place_id: restaurant.placeId,
    p_restaurant_name: restaurant.name,
  });

  if (!error) {
    return (data ?? []).map(mapMenuRow);
  }

  console.warn('[menuItems] get_menu_items_for_restaurant failed, using name lookup:', error.message);
  const { data: legacy, error: legacyError } = await supabase
    .from('menu_items')
    .select('*')
    .eq('restaurant_name', restaurant.name)
    .eq('is_out_of_stock', false);

  if (legacyError) {
    console.warn('[menuItems] Name lookup failed too:', legacyError.message);
    return [];
  }
  return (legacy ?? []).map(mapMenuRow);
}

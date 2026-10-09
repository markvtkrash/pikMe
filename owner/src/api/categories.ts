import { supabase } from './supabase';
import { choiceFromGuess, CategoryChoice, parseCategories, RestaurantCategory } from '../utils/categories';

// The categories an admin offers (migration 129), grouped by the apps into place type, ways to order and cuisine.
export async function getRestaurantCategories(): Promise<RestaurantCategory[]> {
  const { data, error } = await supabase.rpc('get_restaurant_categories');
  if (error) throw error;
  return parseCategories(data);
}

// Google's guess for a list of Google place types, as a choice to pre-fill the form with. A failure gives an empty guess
// (the owner just picks), so a problem here never blocks claiming.
export async function getGoogleGuess(googleTypes: string[]): Promise<CategoryChoice> {
  const { data, error } = await supabase.rpc('categorize_google_types', { p_types: googleTypes });
  if (error) {
    console.warn('[categories] could not get the suggestion:', error.message);
    return choiceFromGuess(null);
  }
  return choiceFromGuess(data);
}

// The Google place types stored for a restaurant (what the suggestion is based on), or none.
export async function getStoredGoogleTypes(googlePlaceId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('cached_restaurants')
    .select('cuisine_types')
    .eq('place_id', googlePlaceId)
    .maybeSingle();
  if (error || !data || !Array.isArray(data.cuisine_types)) return [];
  return data.cuisine_types.filter((t: unknown): t is string => typeof t === 'string');
}

// Saves the owner's choice on their restaurant row. The database checks the keys and that a place type is chosen.
export async function saveRestaurantCategories(restaurantId: string, choice: CategoryChoice) {
  const { data, error } = await supabase
    .from('restaurants')
    .update({
      venue_types: choice.venueTypes,
      services: choice.services,
      cuisines: choice.cuisines,
      updated_at: new Date().toISOString(),
    })
    .eq('id', restaurantId)
    .select('venue_types, services, cuisines')
    .single();
  if (error) throw error;
  return data as { venue_types: string[]; services: string[]; cuisines: string[] };
}

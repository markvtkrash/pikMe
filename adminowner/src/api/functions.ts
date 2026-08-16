import { supabase } from './supabase';
import type { UserProfile, Restaurant, MenuItem, Recommendation, SavedItems, Message } from '../types';

// ─── Onboarding ───────────────────────────────────────────────────────────────

// ─── Restaurants ─────────────────────────────────────────────────────────────

export async function fetchNearbyRestaurants(
  latitude: number,
  longitude: number,
  radiusMeters: number
): Promise<Restaurant[]> {
  const { data, error } = await supabase.functions.invoke('fetch-nearby-restaurants', {
    body: { latitude, longitude, radiusMeters },
  });
  if (error) {
    // Extract actual error message from Edge Function response body
    try {
      const body = await (error as any).context?.json?.();
      console.error('[PikMe] Edge Function error body:', body);
      if (body?.error) throw new Error(body.error);
    } catch (parseErr: any) {
      if (parseErr?.message && parseErr.message !== 'body used already') throw parseErr;
    }
    throw error;
  }
  return data as Restaurant[];
}

// ─── Menu items ───────────────────────────────────────────────────────────────

export async function fetchMenuItems(restaurantName: string): Promise<MenuItem[]> {
  const { data, error } = await supabase.functions.invoke('fetch-menu-items', {
    body: { restaurantName },
  });
  if (error) throw error;
  return data as MenuItem[];
}

export async function fetchMenuItemsAi(restaurantName: string): Promise<MenuItem[]> {
  const { data, error } = await supabase.functions.invoke('fetch-menu-items-ai', {
    body: { restaurantName },
  });
  if (error) {
    try {
      const body = await (error as any).context?.json?.();
      console.error('[PikMe] fetch-menu-items-ai error body:', body);
      if (body?.error) throw new Error(body.error);
    } catch (parseErr: any) {
      if (parseErr?.message && parseErr.message !== 'body used already') throw parseErr;
    }
    throw error;
  }
  return data as MenuItem[];
}

// ─── AI item analysis ("Should I get this?") ─────────────────────────────────

export async function getItemAnalysis(
  itemId: string,
  menuItem: MenuItem,
  profile: UserProfile
): Promise<string> {
  // Check DB cache first (analysis is shared across users for same item)
  const { data: cached } = await supabase.rpc('get_item_analysis', { p_item_id: itemId });
  if (cached) return cached as string;

  const { data, error } = await supabase.functions.invoke('ai-item-analysis', {
    body: { menuItem, profile },
  });
  if (error) {
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) throw new Error(body.error);
    } catch (parseErr: any) {
      if (parseErr?.message && parseErr.message !== 'body used already') throw parseErr;
    }
    throw error;
  }
  return (data as { analysis: string }).analysis;
}

// ─── AI onboarding — extract profile from free text ──────────────────────────

export async function aiOnboard(freeText: string): Promise<Partial<UserProfile>> {
  const { data, error } = await supabase.functions.invoke('ai-onboard', {
    body: { freeText },
  });
  if (error) {
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) throw new Error(body.error);
    } catch (parseErr: any) {
      if (parseErr?.message && parseErr.message !== 'body used already') throw parseErr;
    }
    throw error;
  }
  return data as Partial<UserProfile>;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export async function sendChatMessage(
  message: string,
  profile: UserProfile,
  nearbyRestaurantNames: string[]
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: { message, profile, nearbyRestaurantNames },
  });
  if (error) {
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) throw new Error(body.error);
    } catch (parseErr: any) {
      if (parseErr?.message && parseErr.message !== 'body used already') throw parseErr;
    }
    throw error;
  }
  return (data as { response: string }).response;
}

// ─── Saved items ──────────────────────────────────────────────────────────────

export async function getSavedItems(): Promise<SavedItems> {
  const { data, error } = await supabase.rpc('get_saved_items');
  if (error) throw error;
  const raw = data as { restaurants: any[]; menuItems: any[] };
  return {
    restaurants: (raw.restaurants ?? []).map(mapDbRestaurant),
    menuItems: (raw.menuItems ?? []).map(mapDbMenuItem),
  };
}

function mapDbRestaurant(r: any): Restaurant {
  return {
    placeId: r.place_id,
    name: r.name,
    location: {
      latitude: r.latitude ?? 0,
      longitude: r.longitude ?? 0,
      address: r.address ?? '',
      city: r.city ?? '',
    },
    distanceMeters: 0,
    rating: r.rating ?? 0,
    cuisineTypes: r.cuisine_types ?? [],
    photoUrl: undefined,
    openNow: r.open_now ?? false,
    openingHours: r.opening_hours ?? undefined,
    hasNutritionData: false,
  };
}

function mapDbMenuItem(m: any): MenuItem {
  return {
    itemId: m.item_id,
    restaurantName: m.restaurant_name,
    name: m.name,
    imageUrl: m.image_url ?? undefined,
    isVerified: m.is_verified ?? false,
    nutrition: {
      calories: m.calories ?? 0,
      totalFat_g: m.total_fat_g ?? 0,
      saturatedFat_g: m.saturated_fat_g ?? 0,
      sodium_mg: m.sodium_mg ?? 0,
      totalCarbs_g: m.total_carbs_g ?? 0,
      dietaryFiber_g: 0,
      sugars_g: 0,
      protein_g: m.protein_g ?? 0,
      servingWeightGrams: m.serving_weight_grams ?? undefined,
    },
  };
}

export async function toggleSavedRestaurant(placeId: string, restaurant?: Restaurant): Promise<boolean> {
  // Ensure the restaurant row exists before inserting the FK reference.
  // The edge function caches restaurants on browse, but if that upsert failed
  // (e.g. first deploy before the flatten fix), we guarantee it here instead.
  if (restaurant) {
    await supabase.rpc('upsert_restaurants', {
      p_restaurants: [{
        placeId:        restaurant.placeId,
        name:           restaurant.name,
        latitude:       restaurant.location.latitude,
        longitude:      restaurant.location.longitude,
        address:        restaurant.location.address,
        city:           restaurant.location.city,
        rating:         restaurant.rating,
        priceLevel:     null,
        cuisineTypes:   restaurant.cuisineTypes,
      }],
    });
  }
  const { data, error } = await supabase.rpc('toggle_saved_restaurant', { p_place_id: placeId });
  if (error) throw error;
  return data as boolean;
}

export async function toggleSavedMenuItem(itemId: string, menuItem?: MenuItem): Promise<boolean> {
  if (menuItem) {
    // Cache the item first so the saved_menu_items FK (-> menu_items.item_id) is satisfied.
    const { error: upsertError } = await supabase.rpc('upsert_menu_items', {
      p_items: [{
        itemId:          menuItem.itemId,
        restaurantName:     menuItem.restaurantName,
        name:               menuItem.name,
        servingWeightGrams: menuItem.nutrition.servingWeightGrams ?? null,
        calories:           menuItem.nutrition.calories,
        totalFat_g:         menuItem.nutrition.totalFat_g,
        saturatedFat_g:     menuItem.nutrition.saturatedFat_g,
        sodium_mg:          menuItem.nutrition.sodium_mg,
        totalCarbs_g:       menuItem.nutrition.totalCarbs_g,
        protein_g:          menuItem.nutrition.protein_g,
        imageUrl:           menuItem.imageUrl ?? null,
        isVerified:         menuItem.isVerified,
      }],
    });
    if (upsertError) {
      console.error('[toggleSavedMenuItem] upsert_menu_items failed:', JSON.stringify(upsertError, null, 2));
      throw upsertError;
    }
  }
  const { data, error } = await supabase.rpc('toggle_saved_menu_item', { p_item_id: itemId });
  if (error) {
    console.error('[toggleSavedMenuItem] toggle_saved_menu_item failed:', JSON.stringify(error, null, 2));
    throw error;
  }
  return data as boolean;
}

// ─── User profile ─────────────────────────────────────────────────────────────

export async function getUserProfile(): Promise<UserProfile | null> {
  const { data, error } = await supabase.rpc('get_user_profile');
  if (error) throw error;
  return data as UserProfile | null;
}

export async function upsertUserProfile(profile: Omit<UserProfile, 'id'>): Promise<void> {
  const { error } = await supabase.rpc('upsert_user_profile', {
    p_display_name:         profile.displayName,
    p_dietary_restrictions: profile.dietaryRestrictions,
    p_health_goals:         profile.healthGoals,
    p_allergens:            profile.allergens,
    p_cuisine_preferences:  profile.cuisinePreferences,
    p_nutrition_targets:    profile.nutritionTargets,
    p_search_radius_meters: profile.searchRadiusMeters,
    p_onboarding_complete:  profile.onboardingComplete,
  });
  if (error) throw error;
}

/**
 * Permanently delete the signed-in user's account and all associated data.
 * Runs server-side via the `delete-user` edge function, which only ever acts on
 * the verified caller. On success the local session is cleared.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-user', { body: {} });
  if (error) {
    // FunctionsHttpError carries the real response; surface the server's error
    // message instead of the generic "non-2xx status code".
    let detail = error.message;
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) detail = body.error;
    } catch {
      /* body wasn't JSON — keep the generic message */
    }
    throw new Error(detail);
  }
  await supabase.auth.signOut();
}

// ─── Recommendation logs ──────────────────────────────────────────────────────

export async function logRecommendationAction(
  placeId: string,
  itemId: string,
  score: number,
  action: 'viewed' | 'saved' | 'dismissed'
): Promise<void> {
  const { error } = await supabase.rpc('log_recommendation_action', {
    p_place_id:    placeId,
    p_item_id: itemId,
    p_score:       score,
    p_action:      action,
  });
  if (error) throw error;
}

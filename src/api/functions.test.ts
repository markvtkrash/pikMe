jest.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: jest.fn() },
    rpc: jest.fn(),
    auth: { signOut: jest.fn() },
  },
}));

import { supabase } from './supabase';
import {
  fetchNearbyRestaurants,
  fetchMenuItems,
  fetchMenuItemsAi,
  getItemAnalysis,
  aiOnboard,
  sendChatMessage,
  getSavedItems,
  toggleSavedRestaurant,
  toggleSavedMenuItem,
  getUserProfile,
  upsertUserProfile,
  deleteAccount,
  logRecommendationAction,
} from './functions';
import type { MenuItem, Restaurant, UserProfile } from '../types';

const invoke = supabase.functions.invoke as jest.Mock;
const rpc = supabase.rpc as jest.Mock;
const signOut = supabase.auth.signOut as jest.Mock;

function errorWithBody(body: any): any {
  return { message: 'non-2xx status code', context: { json: async () => body } };
}

function errorWithRejectingJson(rejection: any): any {
  return { message: 'non-2xx status code', context: { json: async () => { throw rejection; } } };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('fetchNearbyRestaurants', () => {
  it('invokes the edge function with lat/lon/radius and returns data', async () => {
    const restaurants = [{ placeId: 'p1' }];
    invoke.mockResolvedValue({ data: restaurants, error: null });

    const result = await fetchNearbyRestaurants(40.1, -74.2, 5000);

    expect(invoke).toHaveBeenCalledWith('fetch-nearby-restaurants', {
      body: { latitude: 40.1, longitude: -74.2, radiusMeters: 5000 },
    });
    expect(result).toBe(restaurants);
  });

  it('throws the extracted message when the error body has an error field', async () => {
    invoke.mockResolvedValue({ data: null, error: errorWithBody({ error: 'Rate limited' }) });

    await expect(fetchNearbyRestaurants(0, 0, 1000)).rejects.toThrow('Rate limited');
  });

  it('throws the original error when there is no context to parse', async () => {
    const original = { message: 'network down' };
    invoke.mockResolvedValue({ data: null, error: original });

    await expect(fetchNearbyRestaurants(0, 0, 1000)).rejects.toBe(original);
  });

  it('rethrows a genuine JSON-parse failure instead of the original error', async () => {
    const parseFailure = new Error('Unexpected token');
    invoke.mockResolvedValue({ data: null, error: errorWithRejectingJson(parseFailure) });

    await expect(fetchNearbyRestaurants(0, 0, 1000)).rejects.toBe(parseFailure);
  });

  it('falls through to the original error when the body was already consumed', async () => {
    const original = errorWithRejectingJson(new Error('body used already'));
    invoke.mockResolvedValue({ data: null, error: original });

    await expect(fetchNearbyRestaurants(0, 0, 1000)).rejects.toBe(original);
  });
});

describe('fetchMenuItems', () => {
  it('returns data on success', async () => {
    const items = [{ itemId: 'i1' }];
    invoke.mockResolvedValue({ data: items, error: null });

    await expect(fetchMenuItems('Subway')).resolves.toBe(items);
    expect(invoke).toHaveBeenCalledWith('fetch-menu-items', { body: { restaurantName: 'Subway' } });
  });

  it('throws the raw error with no body extraction', async () => {
    const original = { message: 'boom' };
    invoke.mockResolvedValue({ data: null, error: original });

    await expect(fetchMenuItems('Subway')).rejects.toBe(original);
  });
});

describe('fetchMenuItemsAi', () => {
  it('returns data on success', async () => {
    const items = [{ itemId: 'ai-1' }];
    invoke.mockResolvedValue({ data: items, error: null });

    await expect(fetchMenuItemsAi('Chipotle')).resolves.toBe(items);
  });

  it('throws the extracted message from the error body', async () => {
    invoke.mockResolvedValue({ data: null, error: errorWithBody({ error: 'LLM unavailable' }) });

    await expect(fetchMenuItemsAi('Chipotle')).rejects.toThrow('LLM unavailable');
  });
});

describe('getItemAnalysis', () => {
  const menuItem = { itemId: 'i1' } as unknown as MenuItem;
  const profile = { id: 'u1' } as unknown as UserProfile;

  it('returns the cached analysis without calling the edge function', async () => {
    rpc.mockResolvedValue({ data: 'Cached analysis' });

    const result = await getItemAnalysis('i1', menuItem, profile);

    expect(result).toBe('Cached analysis');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('calls the edge function and returns the analysis on a cache miss', async () => {
    rpc.mockResolvedValue({ data: null });
    invoke.mockResolvedValue({ data: { analysis: 'Fresh analysis' }, error: null });

    const result = await getItemAnalysis('i1', menuItem, profile);

    expect(invoke).toHaveBeenCalledWith('ai-item-analysis', { body: { menuItem, profile } });
    expect(result).toBe('Fresh analysis');
  });
});

describe('aiOnboard', () => {
  it('returns the extracted profile on success', async () => {
    const partial = { displayName: 'Alex' };
    invoke.mockResolvedValue({ data: partial, error: null });

    await expect(aiOnboard('I like spicy food')).resolves.toBe(partial);
  });

  it('throws the extracted message from the error body', async () => {
    invoke.mockResolvedValue({ data: null, error: errorWithBody({ error: 'Could not parse' }) });

    await expect(aiOnboard('gibberish')).rejects.toThrow('Could not parse');
  });
});

describe('sendChatMessage', () => {
  it('returns the response text on success', async () => {
    invoke.mockResolvedValue({ data: { response: 'Try the salad' }, error: null });

    await expect(sendChatMessage('what should I eat', {} as UserProfile, ['Subway'])).resolves.toBe(
      'Try the salad'
    );
  });

  it('throws the extracted message from the error body', async () => {
    invoke.mockResolvedValue({ data: null, error: errorWithBody({ error: 'Chat down' }) });

    await expect(sendChatMessage('hi', {} as UserProfile, [])).rejects.toThrow('Chat down');
  });
});

describe('getSavedItems', () => {
  it('maps raw DB rows into Restaurant/MenuItem shapes with defaults for missing fields', async () => {
    rpc.mockResolvedValue({
      data: {
        restaurants: [{ place_id: 'p1', name: 'Diner' }],
        menuItems: [{ item_id: 'i1', restaurant_name: 'Diner', name: 'Burger' }],
      },
    });

    const result = await getSavedItems();

    expect(result.restaurants).toEqual([
      {
        placeId: 'p1',
        name: 'Diner',
        location: { latitude: 0, longitude: 0, address: '', city: '' },
        distanceMeters: 0,
        rating: 0,
        cuisineTypes: [],
        photoUrl: undefined,
        openNow: false,
        openingHours: undefined,
        hasNutritionData: false,
      },
    ]);
    expect(result.menuItems).toEqual([
      {
        itemId: 'i1',
        restaurantName: 'Diner',
        name: 'Burger',
        imageUrl: undefined,
        isVerified: false,
        nutrition: {
          calories: 0,
          totalFat_g: 0,
          saturatedFat_g: 0,
          sodium_mg: 0,
          totalCarbs_g: 0,
          dietaryFiber_g: 0,
          sugars_g: 0,
          protein_g: 0,
          servingWeightGrams: undefined,
        },
      },
    ]);
  });

  it('returns empty arrays when restaurants/menuItems are missing', async () => {
    rpc.mockResolvedValue({ data: {} });

    const result = await getSavedItems();

    expect(result).toEqual({ restaurants: [], menuItems: [] });
  });
});

describe('toggleSavedRestaurant', () => {
  const restaurant: Restaurant = {
    placeId: 'p1',
    name: 'Diner',
    location: { latitude: 1, longitude: 2, address: 'addr', city: 'city' },
    distanceMeters: 100,
    rating: 4,
    cuisineTypes: ['american'],
    openNow: true,
    hasNutritionData: false,
  };

  it('upserts the restaurant before toggling when a restaurant is provided', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null }); // upsert_restaurants
    rpc.mockResolvedValueOnce({ data: true, error: null }); // toggle_saved_restaurant

    const result = await toggleSavedRestaurant('p1', restaurant);

    expect(rpc).toHaveBeenNthCalledWith(1, 'upsert_restaurants', expect.objectContaining({
      p_restaurants: [expect.objectContaining({ placeId: 'p1', name: 'Diner' })],
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'toggle_saved_restaurant', { p_place_id: 'p1' });
    expect(result).toBe(true);
  });

  it('skips the upsert when no restaurant is provided', async () => {
    rpc.mockResolvedValue({ data: false, error: null });

    const result = await toggleSavedRestaurant('p1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('toggle_saved_restaurant', { p_place_id: 'p1' });
    expect(result).toBe(false);
  });

  it('throws when the toggle RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'db error' } });

    await expect(toggleSavedRestaurant('p1')).rejects.toEqual({ message: 'db error' });
  });
});

describe('toggleSavedMenuItem', () => {
  const menuItem: MenuItem = {
    itemId: 'i1',
    restaurantName: 'Diner',
    name: 'Burger',
    isVerified: false,
    nutrition: {
      calories: 500,
      totalFat_g: 20,
      saturatedFat_g: 5,
      sodium_mg: 800,
      totalCarbs_g: 40,
      dietaryFiber_g: 3,
      sugars_g: 5,
      protein_g: 25,
    },
  };

  it('upserts the item before toggling when a menu item is provided', async () => {
    rpc.mockResolvedValueOnce({ error: null }); // upsert_menu_items
    rpc.mockResolvedValueOnce({ data: true, error: null }); // toggle_saved_menu_item

    const result = await toggleSavedMenuItem('i1', menuItem);

    expect(rpc).toHaveBeenNthCalledWith(1, 'upsert_menu_items', expect.objectContaining({
      p_items: [expect.objectContaining({ itemId: 'i1', name: 'Burger' })],
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'toggle_saved_menu_item', { p_item_id: 'i1' });
    expect(result).toBe(true);
  });

  it('throws when the upsert fails and never calls toggle', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'upsert failed' } });

    await expect(toggleSavedMenuItem('i1', menuItem)).rejects.toEqual({ message: 'upsert failed' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('throws when the toggle fails after a successful upsert', async () => {
    rpc.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'toggle failed' } });

    await expect(toggleSavedMenuItem('i1', menuItem)).rejects.toEqual({ message: 'toggle failed' });
  });
});

describe('getUserProfile', () => {
  it('returns the profile data', async () => {
    const profile = { id: 'u1', displayName: 'Alex' };
    rpc.mockResolvedValue({ data: profile, error: null });

    await expect(getUserProfile()).resolves.toBe(profile);
  });

  it('throws on error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not found' } });

    await expect(getUserProfile()).rejects.toEqual({ message: 'not found' });
  });
});

describe('upsertUserProfile', () => {
  it('passes the profile fields as p_-prefixed RPC params', async () => {
    rpc.mockResolvedValue({ error: null });
    const profile: Omit<UserProfile, 'id'> = {
      displayName: 'Alex',
      dietaryRestrictions: ['vegan'],
      healthGoals: ['low_carb'],
      cuisinePreferences: ['italian'],
      allergens: ['peanut'],
      nutritionTargets: { maxMealCalories: 600 },
      searchRadiusMeters: 5000,
      onboardingComplete: true,
    };

    await upsertUserProfile(profile);

    expect(rpc).toHaveBeenCalledWith('upsert_user_profile', {
      p_display_name: 'Alex',
      p_dietary_restrictions: ['vegan'],
      p_health_goals: ['low_carb'],
      p_allergens: ['peanut'],
      p_cuisine_preferences: ['italian'],
      p_nutrition_targets: { maxMealCalories: 600 },
      p_search_radius_meters: 5000,
      p_onboarding_complete: true,
    });
  });
});

describe('deleteAccount', () => {
  it('signs the user out on success', async () => {
    invoke.mockResolvedValue({ error: null });

    await deleteAccount();

    expect(invoke).toHaveBeenCalledWith('delete-user', { body: {} });
    expect(signOut).toHaveBeenCalled();
  });

  it('throws the server-provided detail message on error', async () => {
    invoke.mockResolvedValue({ error: errorWithBody({ error: 'Account already deleted' }) });

    await expect(deleteAccount()).rejects.toThrow('Account already deleted');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('falls back to the generic error message when the body is not JSON', async () => {
    const original = { message: 'generic failure', context: { json: async () => { throw new Error('not json'); } } };
    invoke.mockResolvedValue({ error: original });

    await expect(deleteAccount()).rejects.toThrow('generic failure');
  });
});

describe('logRecommendationAction', () => {
  it('passes all params through to the RPC', async () => {
    rpc.mockResolvedValue({ error: null });

    await logRecommendationAction('p1', 'i1', 87, 'saved');

    expect(rpc).toHaveBeenCalledWith('log_recommendation_action', {
      p_place_id: 'p1',
      p_item_id: 'i1',
      p_score: 87,
      p_action: 'saved',
    });
  });

  it('throws on error', async () => {
    rpc.mockResolvedValue({ error: { message: 'log failed' } });

    await expect(logRecommendationAction('p1', 'i1', 87, 'viewed')).rejects.toEqual({ message: 'log failed' });
  });
});

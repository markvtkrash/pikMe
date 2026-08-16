import { useSavedStore } from './savedStore';
import type { MenuItem, Restaurant } from '../types';

const initialState = useSavedStore.getState();

beforeEach(() => {
  useSavedStore.setState(initialState, true);
});

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    placeId: 'p1',
    name: 'Diner',
    location: { latitude: 0, longitude: 0, address: 'addr', city: 'city' },
    distanceMeters: 100,
    rating: 4,
    cuisineTypes: ['american'],
    openNow: true,
    hasNutritionData: false,
    ...overrides,
  };
}

function makeMenuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
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
    ...overrides,
  };
}

describe('savedStore', () => {
  it('starts empty and not loaded', () => {
    const s = useSavedStore.getState();
    expect(s.restaurantIds.size).toBe(0);
    expect(s.menuItemIds.size).toBe(0);
    expect(s.restaurants).toEqual([]);
    expect(s.menuItems).toEqual([]);
    expect(s.isLoaded).toBe(false);
  });

  it('setAll populates state and marks it loaded', () => {
    const restaurant = makeRestaurant();
    const menuItem = makeMenuItem();

    useSavedStore.getState().setAll([restaurant], [menuItem]);

    const s = useSavedStore.getState();
    expect(s.restaurants).toEqual([restaurant]);
    expect(s.menuItems).toEqual([menuItem]);
    expect(s.restaurantIds.has('p1')).toBe(true);
    expect(s.menuItemIds.has('i1')).toBe(true);
    expect(s.isLoaded).toBe(true);
  });

  it('markLoaded flips isLoaded without touching other state', () => {
    useSavedStore.getState().markLoaded();

    const s = useSavedStore.getState();
    expect(s.isLoaded).toBe(true);
    expect(s.restaurants).toEqual([]);
  });

  describe('toggleRestaurantId', () => {
    it('adds the id and prepends the restaurant when not already saved', () => {
      const restaurant = makeRestaurant();
      useSavedStore.getState().toggleRestaurantId('p1', restaurant);

      const s = useSavedStore.getState();
      expect(s.restaurantIds.has('p1')).toBe(true);
      expect(s.restaurants).toEqual([restaurant]);
    });

    it('adds only the id when no restaurant object is provided', () => {
      useSavedStore.getState().toggleRestaurantId('p1');

      const s = useSavedStore.getState();
      expect(s.restaurantIds.has('p1')).toBe(true);
      expect(s.restaurants).toEqual([]);
    });

    it('removes the id and the restaurant when already saved', () => {
      const restaurant = makeRestaurant();
      useSavedStore.getState().setAll([restaurant], []);

      useSavedStore.getState().toggleRestaurantId('p1', restaurant);

      const s = useSavedStore.getState();
      expect(s.restaurantIds.has('p1')).toBe(false);
      expect(s.restaurants).toEqual([]);
    });

    it('does not duplicate the restaurant if it is already in the list', () => {
      const restaurant = makeRestaurant();
      useSavedStore.setState({
        restaurantIds: new Set(['p1']),
        restaurants: [restaurant],
      });

      // toggling with a different id should just add, leaving p1's restaurant entry alone
      useSavedStore.getState().toggleRestaurantId('p2', makeRestaurant({ placeId: 'p2', name: 'Other' }));

      const s = useSavedStore.getState();
      expect(s.restaurants.filter((r) => r.placeId === 'p1')).toHaveLength(1);
    });
  });

  describe('toggleMenuItemId', () => {
    it('adds the id and prepends the item when not already saved', () => {
      const item = makeMenuItem();
      useSavedStore.getState().toggleMenuItemId('i1', item);

      const s = useSavedStore.getState();
      expect(s.menuItemIds.has('i1')).toBe(true);
      expect(s.menuItems).toEqual([item]);
    });

    it('removes the id and the item when already saved', () => {
      const item = makeMenuItem();
      useSavedStore.getState().setAll([], [item]);

      useSavedStore.getState().toggleMenuItemId('i1', item);

      const s = useSavedStore.getState();
      expect(s.menuItemIds.has('i1')).toBe(false);
      expect(s.menuItems).toEqual([]);
    });
  });
});

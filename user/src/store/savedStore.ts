import { create } from 'zustand';
import type { Restaurant, MenuItem } from '../types';

interface SavedStore {
  restaurantIds: Set<string>;
  menuItemIds: Set<string>;
  restaurants: Restaurant[];
  menuItems: MenuItem[];
  isLoaded: boolean;
  setAll: (restaurants: Restaurant[], menuItems: MenuItem[]) => void;
  markLoaded: () => void;
  toggleRestaurantId: (id: string, restaurant?: Restaurant) => void;
  toggleMenuItemId: (id: string, menuItem?: MenuItem) => void;
}

export const useSavedStore = create<SavedStore>((set) => ({
  restaurantIds: new Set(),
  menuItemIds: new Set(),
  restaurants: [],
  menuItems: [],
  isLoaded: false,
  setAll: (restaurants, menuItems) =>
    set({
      restaurants,
      menuItems,
      restaurantIds: new Set(restaurants.map((r) => r.placeId)),
      menuItemIds: new Set(menuItems.map((m) => m.itemId)),
      isLoaded: true,
    }),
  markLoaded: () => set({ isLoaded: true }),
  toggleRestaurantId: (id, restaurant) =>
    set((s) => {
      const next = new Set(s.restaurantIds);
      if (next.has(id)) {
        next.delete(id);
        return { restaurantIds: next, restaurants: s.restaurants.filter((r) => r.placeId !== id) };
      }
      next.add(id);
      // Keep the list in sync with the id Set so the Saved screen reflects the
      // new favorite immediately (not just the heart on Explore).
      const restaurants = restaurant && !s.restaurants.some((r) => r.placeId === id)
        ? [restaurant, ...s.restaurants]
        : s.restaurants;
      return { restaurantIds: next, restaurants };
    }),
  toggleMenuItemId: (id, menuItem) =>
    set((s) => {
      const next = new Set(s.menuItemIds);
      if (next.has(id)) {
        next.delete(id);
        return { menuItemIds: next, menuItems: s.menuItems.filter((m) => m.itemId !== id) };
      }
      next.add(id);
      const menuItems = menuItem && !s.menuItems.some((m) => m.itemId === id)
        ? [menuItem, ...s.menuItems]
        : s.menuItems;
      return { menuItemIds: next, menuItems };
    }),
}));

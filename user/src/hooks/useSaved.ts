import { useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import { useSavedStore } from '../store/savedStore';
import { getSavedItems, toggleSavedRestaurant, toggleSavedMenuItem } from '../api/functions';
import type { Restaurant, MenuItem } from '../types';

export function useSaved() {
  const store = useSavedStore();

  async function load() {
    try {
      const data = await getSavedItems();
      store.setAll(data.restaurants, data.menuItems);
    } catch (err) {
      // Don't leave the UI spinning forever — mark loaded so the empty state
      // shows. Log the error so we can diagnose why the RPC failed.
      console.error('[useSaved] Failed to load saved items:', JSON.stringify(err, null, 2));
      store.markLoaded();
    }
  }

  const toggleRestaurant = useCallback(async (placeId: string, restaurant?: Restaurant) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    store.toggleRestaurantId(placeId, restaurant); // optimistic
    try {
      await toggleSavedRestaurant(placeId, restaurant);
    } catch {
      store.toggleRestaurantId(placeId, restaurant); // revert on failure
    }
  }, [store]);

  const toggleMenuItem = useCallback(async (itemId: string, menuItem?: MenuItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    store.toggleMenuItemId(itemId, menuItem);
    try {
      await toggleSavedMenuItem(itemId, menuItem);
    } catch {
      store.toggleMenuItemId(itemId, menuItem);
    }
  }, [store]);

  return {
    restaurantIds: store.restaurantIds,
    menuItemIds: store.menuItemIds,
    savedRestaurants: store.restaurants,
    savedMenuItems: store.menuItems,
    isLoaded: store.isLoaded,
    load,
    toggleRestaurant,
    toggleMenuItem,
  };
}

import { create } from 'zustand';
import type { Restaurant } from '../types';

interface Coords {
  latitude: number;
  longitude: number;
}

interface RestaurantStore {
  restaurants: Restaurant[];
  selectedRestaurantId: string | null;
  userLocation: Coords | null;
  // Shared between the Map and Explore tabs so picking a radius on one
  // carries over to the other instead of resetting per screen.
  searchRadiusMeters: number;
  setRestaurants: (restaurants: Restaurant[]) => void;
  setSelectedRestaurantId: (id: string | null) => void;
  setUserLocation: (loc: Coords | null) => void;
  setSearchRadiusMeters: (meters: number) => void;
}

export const useRestaurantStore = create<RestaurantStore>((set) => ({
  restaurants: [],
  selectedRestaurantId: null,
  userLocation: null,
  searchRadiusMeters: 2000,
  setRestaurants: (restaurants) => set({ restaurants }),
  setSelectedRestaurantId: (id) => set({ selectedRestaurantId: id }),
  setUserLocation: (userLocation) => set({ userLocation }),
  setSearchRadiusMeters: (searchRadiusMeters) => set({ searchRadiusMeters }),
}));

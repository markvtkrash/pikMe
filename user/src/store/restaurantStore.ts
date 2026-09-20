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
  // Location tracking is owned by a single <LocationTracker> mounted once in
  // the (main) layout — Map and Explore both used to run their own
  // independent useLocation() GPS watcher, which could occasionally produce
  // two slightly different readings for the same moment (straddling the
  // 200m fetch-cache grid) and always meant two live watchPositionAsync
  // subscriptions running at once. These fields are what that tracker writes
  // to and what useLocation() now just reads back.
  locationLoading: boolean;
  locationError: string | null;
  locationRefreshNonce: number;
  setRestaurants: (restaurants: Restaurant[]) => void;
  setSelectedRestaurantId: (id: string | null) => void;
  setUserLocation: (loc: Coords | null) => void;
  setSearchRadiusMeters: (meters: number) => void;
  setLocationLoading: (loading: boolean) => void;
  setLocationError: (error: string | null) => void;
  requestLocationRefresh: () => void;
}

export const useRestaurantStore = create<RestaurantStore>((set) => ({
  restaurants: [],
  selectedRestaurantId: null,
  userLocation: null,
  searchRadiusMeters: 2000,
  locationLoading: true,
  locationError: null,
  locationRefreshNonce: 0,
  setRestaurants: (restaurants) => set({ restaurants }),
  setSelectedRestaurantId: (id) => set({ selectedRestaurantId: id }),
  setUserLocation: (userLocation) => set({ userLocation }),
  setSearchRadiusMeters: (searchRadiusMeters) => set({ searchRadiusMeters }),
  setLocationLoading: (locationLoading) => set({ locationLoading }),
  setLocationError: (locationError) => set({ locationError }),
  requestLocationRefresh: () => set((s) => ({ locationRefreshNonce: s.locationRefreshNonce + 1 })),
}));

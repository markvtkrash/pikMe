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
  // Once the OS has recorded a real "denied" decision, requesting
  // permission again just silently re-returns denied with no fresh native
  // prompt — canAskAgain tells the UI when that's the case, so it can offer
  // "Open Settings" instead of a retry button that can never succeed.
  locationCanAskAgain: boolean;
  locationRefreshNonce: number;
  setRestaurants: (restaurants: Restaurant[]) => void;
  setSelectedRestaurantId: (id: string | null) => void;
  setUserLocation: (loc: Coords | null) => void;
  setSearchRadiusMeters: (meters: number) => void;
  setLocationLoading: (loading: boolean) => void;
  setLocationError: (error: string | null) => void;
  setLocationCanAskAgain: (canAskAgain: boolean) => void;
  requestLocationRefresh: () => void;
}

export const useRestaurantStore = create<RestaurantStore>((set) => ({
  restaurants: [],
  selectedRestaurantId: null,
  userLocation: null,
  searchRadiusMeters: 2000,
  locationLoading: true,
  locationError: null,
  locationCanAskAgain: true,
  locationRefreshNonce: 0,
  setRestaurants: (restaurants) => set({ restaurants }),
  setSelectedRestaurantId: (id) => set({ selectedRestaurantId: id }),
  setUserLocation: (userLocation) => set({ userLocation }),
  setSearchRadiusMeters: (searchRadiusMeters) => set({ searchRadiusMeters }),
  setLocationLoading: (locationLoading) => set({ locationLoading }),
  setLocationError: (locationError) => set({ locationError }),
  setLocationCanAskAgain: (locationCanAskAgain) => set({ locationCanAskAgain }),
  requestLocationRefresh: () => set((s) => ({ locationRefreshNonce: s.locationRefreshNonce + 1 })),
}));

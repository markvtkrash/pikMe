import { useRestaurantStore } from '../store/restaurantStore';

export interface Coords {
  latitude: number;
  longitude: number;
}

// Thin reader over restaurantStore — the actual GPS watching lives in
// <LocationTracker>, mounted once in the (main) layout, so every screen that
// calls this hook shares one live location subscription instead of each
// starting its own.
export function useLocation() {
  const location = useRestaurantStore((s) => s.userLocation);
  const loading = useRestaurantStore((s) => s.locationLoading);
  const error = useRestaurantStore((s) => s.locationError);
  const requestLocationRefresh = useRestaurantStore((s) => s.requestLocationRefresh);

  return { location, error, loading, refresh: requestLocationRefresh };
}

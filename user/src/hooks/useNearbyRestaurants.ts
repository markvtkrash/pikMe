import { useQuery } from '@tanstack/react-query';
import { fetchNearbyRestaurants } from '../api/functions';
import { useRestaurantStore } from '../store/restaurantStore';
import { snapToGrid } from '../utils/geo';
import { MAX_FETCH_RADIUS_METERS } from '../constants/searchRadius';
import type { Coords } from './useLocation';

// Always fetches/caches the full max radius — the 2/3/4/5km picker in the UI
// filters this same result set client-side by distanceMeters instead of
// triggering a new fetch per radius, which also keeps the server-side cache
// check correct (it's always answering "do we have data within 5km?" instead
// of a moving target that could false-positive a "hit" from a smaller
// previous search).
export function useNearbyRestaurants(location: Coords | null) {
  const setRestaurants = useRestaurantStore((s) => s.setRestaurants);

  // Snap to ~200m grid so minor GPS drift doesn't trigger new fetches
  const snappedLat = location ? snapToGrid(location.latitude) : null;
  const snappedLng = location ? snapToGrid(location.longitude) : null;

  return useQuery({
    queryKey: ['nearbyRestaurants', snappedLat, snappedLng],
    queryFn: async () => {
      try {
        const restaurants = await fetchNearbyRestaurants(
          location!.latitude,
          location!.longitude,
          MAX_FETCH_RADIUS_METERS
        );
        setRestaurants(restaurants);
        return restaurants;
      } catch (err: any) {
        console.error('[PikMe] fetchNearbyRestaurants failed:', {
          message: err?.message,
          context: err?.context,
          status: err?.status,
          details: err,
        });
        throw err;
      }
    },
    enabled: !!location,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
}

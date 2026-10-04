import { useQuery } from '@tanstack/react-query';
import { fetchNearbyRestaurants } from '../api/functions';
import { useRestaurantStore } from '../store/restaurantStore';
import { snapToGrid } from '../utils/geo';
import { useMaxRadiusMiles } from './useMaxRadiusMiles';
import type { Coords } from './useLocation';

const METERS_PER_MILE = 1609.34;

// Always fetches/caches the full max radius — the picker in the UI filters
// this same result set client-side by distanceMeters instead of triggering
// a new fetch per radius, which also keeps the server-side cache check
// correct (it's always answering "do we have data within the max radius?"
// instead of a moving target that could false-positive a "hit" from a
// smaller previous search). The max radius itself comes from the same
// app_config value fetch-nearby-restaurants enforces server-side
// (useMaxRadiusMiles) rather than a hardcoded constant, so the two can't
// drift apart the way they did before migration 060.
export function useNearbyRestaurants(location: Coords | null) {
  const setRestaurants = useRestaurantStore((s) => s.setRestaurants);
  const { data: maxRadiusMiles = 6 } = useMaxRadiusMiles();
  const maxFetchRadiusMeters = maxRadiusMiles * METERS_PER_MILE;

  // Snap to ~200m grid so minor GPS drift doesn't trigger new fetches
  const snappedLat = location ? snapToGrid(location.latitude) : null;
  const snappedLng = location ? snapToGrid(location.longitude) : null;

  return useQuery({
    queryKey: ['nearbyRestaurants', snappedLat, snappedLng, maxRadiusMiles],
    queryFn: async () => {
      try {
        const restaurants = await fetchNearbyRestaurants(
          location!.latitude,
          location!.longitude,
          maxFetchRadiusMeters
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

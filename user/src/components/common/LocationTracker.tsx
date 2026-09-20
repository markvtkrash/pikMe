import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { useRestaurantStore } from '../../store/restaurantStore';

// Mounted exactly once (in the (main) layout) so there is a single GPS watch
// for the whole app instead of one per screen that reads location — the Map
// and Explore tabs previously each ran their own useLocation(), meaning two
// concurrent watchPositionAsync subscriptions, and occasionally two slightly
// different readings for the same real-world moment landing in different
// cells of fetch-nearby-restaurants' 200m location-snap grid (an avoidable
// extra Google Places call). Renders nothing — it only writes into
// restaurantStore, which every screen already reads location from.
export function LocationTracker() {
  const setUserLocation = useRestaurantStore((s) => s.setUserLocation);
  const setLocationLoading = useRestaurantStore((s) => s.setLocationLoading);
  const setLocationError = useRestaurantStore((s) => s.setLocationError);
  const locationRefreshNonce = useRestaurantStore((s) => s.locationRefreshNonce);
  const isFirstRun = useRef(true);

  async function requestLocation() {
    setLocationLoading(true);
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission denied. Enable it in Settings.');
        setLocationLoading(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch (err: any) {
      setLocationError(err?.message ?? 'Failed to get location');
    } finally {
      setLocationLoading(false);
    }
  }

  // Initial fetch + the one live watcher for the app's lifetime.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    async function start() {
      await requestLocation();
      try {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 200 },
          (pos) => {
            setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          }
        );
      } catch {
        // watchPositionAsync not available on all platforms (web may silently fail)
      }
    }

    start();
    return () => { sub?.remove(); };
  }, []);

  // A screen's "Enable Location" retry button bumps locationRefreshNonce
  // via requestLocationRefresh() instead of calling requestLocation()
  // directly, since this is the only component that owns that logic.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    requestLocation();
  }, [locationRefreshNonce]);

  return null;
}

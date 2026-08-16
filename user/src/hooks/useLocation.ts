import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { useRestaurantStore } from '../store/restaurantStore';

export interface Coords {
  latitude: number;
  longitude: number;
}

export function useLocation() {
  const [location, setLocation] = useState<Coords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const setUserLocation = useRestaurantStore((s) => s.setUserLocation);

  async function requestLocation() {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied. Enable it in Settings.');
        setLoading(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setLocation(coords);
      setUserLocation(coords);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to get location');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    async function start() {
      await requestLocation();
      try {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 200 },
          (pos) => {
            const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            setLocation(coords);
            setUserLocation(coords);
          }
        );
      } catch {
        // watchPositionAsync not available on all platforms (web may silently fail)
      }
    }

    start();
    return () => { sub?.remove(); };
  }, []);

  return { location, error, loading, refresh: requestLocation };
}

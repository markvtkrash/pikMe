import { useQuery } from '@tanstack/react-query';
import { getRegionAccess } from '../api/region';
import { snapToGrid } from '../utils/geo';
import type { Coords } from './useLocation';

// Asks the server once per place (kept for 5 minutes) whether the customer's state is open. While it has not answered, or when it fails, the
// customer is treated as allowed.
export function useRegionAccess(location: Coords | null) {
  const lat = location ? snapToGrid(location.latitude) : null;
  const lng = location ? snapToGrid(location.longitude) : null;
  return useQuery({
    queryKey: ['regionAccess', lat, lng],
    queryFn: () => getRegionAccess(location!.latitude, location!.longitude),
    enabled: !!location,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 0,
  });
}

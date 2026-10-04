import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabase';

const DEFAULT_MAX_RADIUS_MILES = 6;

// Global, admin-controlled max search radius (app_config row
// 'maxRadiusMiles', managed from the admin app's Config Management page —
// see migrations 057/060). This is the SAME value fetch-nearby-restaurants
// enforces server-side; reading it here too (rather than hardcoding the
// picker options) is what keeps the two from drifting apart again the way
// they did before migration 060 — picking a radius the server never
// actually fetched used to silently do nothing.
export function useMaxRadiusMiles() {
  return useQuery({
    queryKey: ['appConfig', 'maxRadiusMiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'maxRadiusMiles')
        .maybeSingle();
      if (error) {
        console.error('[useMaxRadiusMiles] Failed to load value, defaulting to', DEFAULT_MAX_RADIUS_MILES, error);
        return DEFAULT_MAX_RADIUS_MILES;
      }
      const parsed = Number(data?.value);
      return data?.value && !Number.isNaN(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RADIUS_MILES;
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

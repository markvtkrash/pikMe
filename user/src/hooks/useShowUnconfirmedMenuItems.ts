import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabase';

// Global, admin-controlled switch (app_config row 'showUnconfirmedMenuItems',
// managed from the admin app's Config Management page) for whether
// unconfirmed (is_verified = false) menu items show at all — see migration
// 059. Defaults to false (safer) if the row is missing or the fetch fails,
// same as every other DB-config read in this codebase.
export function useShowUnconfirmedMenuItems() {
  return useQuery({
    queryKey: ['appConfig', 'showUnconfirmedMenuItems'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'showUnconfirmedMenuItems')
        .maybeSingle();
      if (error) {
        console.error('[useShowUnconfirmedMenuItems] Failed to load flag, defaulting to false:', error);
        return false;
      }
      return data?.value === 'true';
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

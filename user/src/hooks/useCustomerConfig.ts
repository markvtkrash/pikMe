import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { supabase } from '../api/supabase';
import { CustomerConfig, DEFAULT_CUSTOMER_CONFIG, parseCustomerConfig } from '../utils/customerConfig';

// The settings the customer app needs, and the live announcements, fetched in ONE request (get_customer_config, migrations 127
// and 128) and shared by every screen, so a phone makes one config call per 10 minutes instead of one per setting. Readable
// before sign-in, which the update-required check needs. The app version is sent so an announcement can be aimed at a range of
// versions. Any failure falls back to safe defaults (nothing blocked, nothing extra shown).
export async function fetchCustomerConfig(): Promise<CustomerConfig> {
  const version = Constants.expoConfig?.version;
  const { data, error } = await supabase.rpc('get_customer_config', version ? { p_app_version: version } : {});
  if (error) {
    console.warn('[customerConfig] could not load the app settings, using defaults:', error.message);
    return DEFAULT_CUSTOMER_CONFIG;
  }
  return parseCustomerConfig(data);
}

export function useCustomerConfig() {
  return useQuery({
    queryKey: ['customerConfig'],
    queryFn: fetchCustomerConfig,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

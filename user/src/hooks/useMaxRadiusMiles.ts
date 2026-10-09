import { useCustomerConfig } from './useCustomerConfig';
import { DEFAULT_MAX_RADIUS_MILES } from '../utils/customerConfig';

// Global, admin-controlled max search radius (app_config row 'maxRadiusMiles', managed from the admin app's Config Management
// page — see migrations 057/060). This is the SAME value fetch-nearby-restaurants enforces server-side; reading it here too
// (rather than hardcoding the picker options) is what keeps the two from drifting apart — picking a radius the server never
// actually fetched used to silently do nothing. It comes from the app's single shared settings call (useCustomerConfig).
export function useMaxRadiusMiles() {
  const { data, ...rest } = useCustomerConfig();
  return { ...rest, data: data?.maxRadiusMiles ?? DEFAULT_MAX_RADIUS_MILES };
}

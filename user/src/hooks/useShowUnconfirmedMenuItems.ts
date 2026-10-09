import { useCustomerConfig } from './useCustomerConfig';

// Global, admin-controlled switch (app_config row 'showUnconfirmedMenuItems', managed from the admin app's Config Management
// page) for whether unconfirmed (is_verified = false) menu items show at all — see migration 059. Defaults to false (safer) if
// the row is missing or the fetch fails. It comes from the app's single shared settings call (useCustomerConfig).
export function useShowUnconfirmedMenuItems() {
  const { data, ...rest } = useCustomerConfig();
  return { ...rest, data: data?.showUnconfirmedMenuItems ?? false };
}

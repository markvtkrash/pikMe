import type { MenuItem } from '../types';

export interface MenuVisibilityRules {
  // Admin-controlled global switch (app_config 'showUnconfirmedMenuItems').
  showUnconfirmed: boolean;
  // The restaurant's name matches the Franchise Lookup (migration 062).
  isFranchise: boolean;
}

// Which menu items a customer may see. Unconfirmed (is_verified = false)
// items — AI guesses and anything the restaurant hasn't checked — are shown
// only when the global flag is on OR the restaurant is a known franchise;
// everything else shows confirmed items only. See migrations 059 and 062.
export function filterVisibleMenuItems<T extends Pick<MenuItem, 'isVerified'>>(
  items: T[],
  rules: MenuVisibilityRules
): T[] {
  if (rules.showUnconfirmed || rules.isFranchise) return items;
  return items.filter((item) => item.isVerified);
}

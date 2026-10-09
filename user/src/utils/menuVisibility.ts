import type { MenuItem } from '../types';

export interface MenuVisibilityRules {
  // Admin-controlled global switch (app_config 'showUnconfirmedMenuItems').
  showUnconfirmed: boolean;
  // The restaurant's name matches the Franchise Lookup (migration 062).
  isFranchise: boolean;
}

// Which menu items a customer may see. Unconfirmed (is_verified = false)
// items — AI guesses and anything the restaurant hasn't checked — are shown
// when the global flag is on OR the restaurant is a known franchise.
// Otherwise, once ANY item is confirmed, only the confirmed items show (someone
// has started checking the menu, so the guesses are dropped). While NOTHING is
// confirmed yet, every item shows, each carrying its "Unconfirmed item" banner
// on the card. See migrations 059 and 062.
export function filterVisibleMenuItems<T extends Pick<MenuItem, 'isVerified'>>(
  items: T[],
  rules: MenuVisibilityRules
): T[] {
  if (rules.showUnconfirmed || rules.isFranchise) return items;
  if (!items.some((item) => item.isVerified)) return items;
  return items.filter((item) => item.isVerified);
}

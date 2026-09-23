// The fixed set of pages an owner can heart to pin a shortcut to their
// Dashboard's Favorites section. Deliberately excludes the Dashboard's own
// quick-links (Menu Management, Reports) since those are already always
// visible there — Reports' individual report pages, Tools pages, and the
// Coupons section's pages are favoritable.
export interface FavoritablePage {
  key: string;
  icon: string;
  label: string;
  href: string;
}

export const FAVORITABLE_PAGES: FavoritablePage[] = [
  { key: 'coupon-add-coupons', icon: '🎟️', label: 'Add Coupons', href: '/restaurant/menu' },
  { key: 'coupon-manage-coupons', icon: '📋', label: 'Manage Coupons', href: '/restaurant/coupon-status' },
  { key: 'menu-ai-pull', icon: '🤖', label: 'AI Assisted Menu Pull', href: '/restaurant/menu-items' },
  { key: 'menu-manual-entry', icon: '✍️', label: 'Edit Menu', href: '/restaurant/manual-menu' },
  { key: 'menu-photo', icon: '📷', label: 'Update Menu Items Using a Photo', href: '/restaurant/menu-photo' },
  { key: 'menu-text', icon: '📋', label: 'Update Menu Items From Text', href: '/restaurant/menu-text' },
  { key: 'report-coupon-performance', icon: '📊', label: 'Coupon Performance', href: '/restaurant/reports/coupon-performance' },
  { key: 'report-redemptions-over-time', icon: '📈', label: 'Redemptions Over Time', href: '/restaurant/reports/redemptions-over-time' },
  { key: 'report-coupon-status-overview', icon: '🎟️', label: 'Coupon Status Overview', href: '/restaurant/reports/coupon-status-overview' },
  { key: 'report-menu-verification-status', icon: '✅', label: 'Menu Verification Status', href: '/restaurant/reports/menu-verification-status' },
  { key: 'report-top-coupons', icon: '🏆', label: 'Top Performing Coupons', href: '/restaurant/reports/top-coupons' },
  { key: 'tool-preview', icon: '👀', label: 'Preview as a Customer', href: '/restaurant/preview' },
  { key: 'tool-relocate', icon: '📍', label: 'My Restaurant Moved', href: '/restaurant/relocate' },
  { key: 'tool-visibility', icon: '⏸', label: 'Visible to Customers', href: '/restaurant/visibility' },
];

export const FAVORITABLE_PAGES_BY_KEY: Record<string, FavoritablePage> =
  Object.fromEntries(FAVORITABLE_PAGES.map((p) => [p.key, p]));

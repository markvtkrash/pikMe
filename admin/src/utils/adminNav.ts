// Navigation data for the admin header: the full list of pages (the ☰ Menu) and
// the short list of quick links shown directly in the top bar.

// Every admin page, in the same order as the dashboard tiles. Add new pages
// here and they show up in the header menu on every screen.
export interface NavItem {
  label: string;
  icon: string;
  href: string;
  match: string;
  // Other pages that belong under this entry (they highlight it too).
  alsoMatch?: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: '🏠', href: '/admin', match: '/admin' },
  { label: 'Pending Claims', icon: '📋', href: '/admin/claims', match: '/admin/claims' },
  { label: 'Relocations', icon: '📍', href: '/admin/relocations', match: '/admin/relocations' },
  { label: 'Restaurants', icon: '🍽️', href: '/admin/restaurants', match: '/admin/restaurants' },
  { label: 'Menu Management', icon: '🧾', href: '/admin/menu-management', match: '/admin/menu-management' },
  { label: 'Coupons', icon: '🎟️', href: '/admin/coupons', match: '/admin/coupons' },
  { label: 'Manage Restaurants', icon: '🏪', href: '/admin/owners', match: '/admin/owners' },
  { label: 'Users', icon: '👥', href: '/admin/users', match: '/admin/users' },
  { label: 'Create Owner', icon: '➕', href: '/admin/create-owner', match: '/admin/create-owner' },
  // The independent restaurant menu issues report is one of the reports, so Reports lights up on it.
  { label: 'Reports', icon: '📊', href: '/admin/reports', match: '/admin/reports', alsoMatch: ['/admin/restaurant-menu-issues'] },
  { label: 'Franchise Lookup', icon: '🍔', href: '/admin/franchises', match: '/admin/franchises' },
  { label: 'Franchise Menu Management', icon: '🔗', href: '/admin/chain-menus', match: '/admin/chain-menus' },
  // Scheduled Builds and App Config live under Tools, so the menu lights up Tools on those pages too.
  {
    label: 'Tools', icon: '🧰', href: '/admin/tools', match: '/admin/tools',
    alsoMatch: ['/admin/scheduled-builds', '/admin/announcements', '/admin/restaurant-categories', '/admin/config'],
  },
  { label: 'Support Tickets', icon: '🎧', href: '/admin/tickets?status=open', match: '/admin/tickets' },
];

// Is `match` the page (or a page under it) the admin is on? The dashboard only
// matches itself, since every other admin path starts with /admin.
export function isNavActive(pathname: string, match: string): boolean {
  if (match === '/admin') return pathname === '/admin';
  return pathname === match || pathname.startsWith(`${match}/`);
}

// Is the admin on this menu entry's page, or on a page that belongs under it?
export function isNavItemActive(pathname: string, item: Pick<NavItem, 'match' | 'alsoMatch'>): boolean {
  return isNavActive(pathname, item.match) || (item.alsoMatch ?? []).some((m) => isNavActive(pathname, m));
}

// The links shown directly in the top bar (wide screens only). Each href must be
// one of the NAV_ITEMS pages; the labels are the ones admins use day to day.
export const QUICK_NAV: { label: string; href: string }[] = [
  { label: 'Menu Management', href: '/admin/menu-management' },
  { label: 'Manage Users', href: '/admin/users' },
  { label: 'Franchise Menu Management', href: '/admin/chain-menus' },
  { label: 'Manage Restaurants', href: '/admin/owners' },
  { label: 'Create Restaurant Owner', href: '/admin/create-owner' },
  { label: 'Tools', href: '/admin/tools' },
];

// Below this window width the top bar would be crowded, so the quick links are
// hidden there; the ☰ Menu still reaches every page at any width.
export const QUICK_NAV_MIN_WIDTH = 1200;

export function showQuickNav(windowWidth: number): boolean {
  return Number.isFinite(windowWidth) && windowWidth >= QUICK_NAV_MIN_WIDTH;
}

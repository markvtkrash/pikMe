import { NAV_ITEMS, QUICK_NAV, QUICK_NAV_MIN_WIDTH, isNavActive, isNavItemActive, showQuickNav } from './adminNav';

describe('QUICK_NAV', () => {
  it('has the requested links, in order', () => {
    expect(QUICK_NAV.map((l) => l.label)).toEqual([
      'Menu Management', 'Manage Users', 'Franchise Menu Management', 'Manage Restaurants', 'Create Restaurant Owner', 'Tools',
    ]);
  });

  it('points each link at a real admin page from the full list', () => {
    const hrefs = new Set(NAV_ITEMS.map((i) => i.href));
    for (const link of QUICK_NAV) expect(hrefs.has(link.href)).toBe(true);
  });

  it('goes to the right pages', () => {
    const byLabel = Object.fromEntries(QUICK_NAV.map((l) => [l.label, l.href]));
    expect(byLabel['Menu Management']).toBe('/admin/menu-management');
    expect(byLabel['Manage Users']).toBe('/admin/users');
    expect(byLabel['Franchise Menu Management']).toBe('/admin/chain-menus');
    expect(byLabel['Manage Restaurants']).toBe('/admin/owners');
    expect(byLabel['Create Restaurant Owner']).toBe('/admin/create-owner');
    expect(byLabel['Tools']).toBe('/admin/tools');
  });

  it('has no duplicate links', () => {
    expect(new Set(QUICK_NAV.map((l) => l.href)).size).toBe(QUICK_NAV.length);
  });
});

describe('NAV_ITEMS', () => {
  it('has unique hrefs and labels, so the menu has no duplicates', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((i) => i.label)).size).toBe(NAV_ITEMS.length);
  });

  it('keeps every page that was in the menu before, including Franchise Menu Management', () => {
    const labels = NAV_ITEMS.map((i) => i.label);
    for (const expected of ['Dashboard', 'Pending Claims', 'Menu Management', 'Users', 'Manage Restaurants', 'Franchise Menu Management', 'Tools']) {
      expect(labels).toContain(expected);
    }
  });
});

describe('isNavActive', () => {
  it('matches the page itself and pages under it', () => {
    expect(isNavActive('/admin/menu-management', '/admin/menu-management')).toBe(true);
    expect(isNavActive('/admin/menu-management/abc', '/admin/menu-management')).toBe(true);
  });

  it('does not match a different page that merely starts the same way', () => {
    expect(isNavActive('/admin/menu-management-old', '/admin/menu-management')).toBe(false);
    expect(isNavActive('/admin/owners', '/admin/users')).toBe(false);
    expect(isNavActive('/admin/chain-menus', '/admin/menu-management')).toBe(false);
  });

  it('matches the dashboard only on the dashboard itself', () => {
    expect(isNavActive('/admin', '/admin')).toBe(true);
    expect(isNavActive('/admin/users', '/admin')).toBe(false);
  });
});

describe('showQuickNav', () => {
  it('shows the links on wide screens and hides them on narrow ones', () => {
    expect(showQuickNav(QUICK_NAV_MIN_WIDTH)).toBe(true);
    expect(showQuickNav(1440)).toBe(true);
    expect(showQuickNav(QUICK_NAV_MIN_WIDTH - 1)).toBe(false);
    expect(showQuickNav(390)).toBe(false);
  });

  it('hides them for an unusable width', () => {
    expect(showQuickNav(NaN)).toBe(false);
    expect(showQuickNav(Infinity)).toBe(false);
  });
});

describe('Tools in the menu', () => {
  const tools = NAV_ITEMS.find((i) => i.label === 'Tools')!;

  it('has a Tools entry and no separate App Config entry (it lives under Tools now)', () => {
    expect(tools.href).toBe('/admin/tools');
    expect(NAV_ITEMS.some((i) => i.label === 'App Config')).toBe(false);
  });

  it('lights up on the Tools page and on the pages under it', () => {
    expect(isNavItemActive('/admin/tools', tools)).toBe(true);
    expect(isNavItemActive('/admin/scheduled-builds', tools)).toBe(true);
    expect(isNavItemActive('/admin/config', tools)).toBe(true);
    expect(isNavItemActive('/admin/users', tools)).toBe(false);
    expect(isNavItemActive('/admin/chain-menus', tools)).toBe(false);
  });

  it('other entries are active only on their own page', () => {
    const users = NAV_ITEMS.find((i) => i.label === 'Users')!;
    expect(isNavItemActive('/admin/users', users)).toBe(true);
    expect(isNavItemActive('/admin/config', users)).toBe(false);
  });
});

describe('Reports in the menu', () => {
  it('lights up on the independent restaurant menu issues report', () => {
    const reports = NAV_ITEMS.find((i) => i.label === 'Reports')!;
    expect(isNavItemActive('/admin/reports', reports)).toBe(true);
    expect(isNavItemActive('/admin/restaurant-menu-issues', reports)).toBe(true);
    expect(isNavItemActive('/admin/owners', reports)).toBe(false);
  });
});

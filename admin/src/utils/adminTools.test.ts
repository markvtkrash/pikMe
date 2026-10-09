import { ADMIN_TOOLS } from './adminTools';
import { NAV_ITEMS } from './adminNav';

describe('ADMIN_TOOLS', () => {
  it('lists Scheduled Builds, Announcements, Restaurant Categories and App Config', () => {
    expect(ADMIN_TOOLS.map((t) => t.title)).toEqual(['Scheduled Builds', 'Announcements', 'Restaurant Categories', 'App Config']);
    const byTitle = Object.fromEntries(ADMIN_TOOLS.map((t) => [t.title, t.href]));
    expect(byTitle['Scheduled Builds']).toBe('/admin/scheduled-builds');
    expect(byTitle['Announcements']).toBe('/admin/announcements');
    expect(byTitle['Restaurant Categories']).toBe('/admin/restaurant-categories');
    expect(byTitle['App Config']).toBe('/admin/config');
  });

  it('has unique keys and addresses, and every field filled in', () => {
    expect(new Set(ADMIN_TOOLS.map((t) => t.key)).size).toBe(ADMIN_TOOLS.length);
    expect(new Set(ADMIN_TOOLS.map((t) => t.href)).size).toBe(ADMIN_TOOLS.length);
    for (const t of ADMIN_TOOLS) {
      for (const field of [t.icon, t.title, t.subtitle, t.color, t.bg, t.href]) expect(field.trim().length).toBeGreaterThan(0);
      expect(t.href.startsWith('/admin/')).toBe(true);
    }
  });

  it('every tool page belongs under Tools in the menu, so the menu highlights Tools on it', () => {
    const tools = NAV_ITEMS.find((i) => i.label === 'Tools')!;
    for (const t of ADMIN_TOOLS) expect(tools.alsoMatch).toContain(t.href);
  });
});

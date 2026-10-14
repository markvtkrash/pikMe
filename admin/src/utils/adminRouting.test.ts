import { ADMIN_HOME_PATH, ADMIN_LOGIN_PATH, AdminRouteState, canShowAdminPage, resolveAdminRoute } from './adminRouting';

const base: AdminRouteState = { hasSession: true, roleCheckComplete: true, isAdmin: true, segments: ['admin', 'owners'] };
const at = (segments: string[], over: Partial<AdminRouteState> = {}): AdminRouteState => ({ ...base, segments, ...over });

describe('resolveAdminRoute', () => {
  it('leaves the entry point alone', () => {
    expect(resolveAdminRoute(at([], { hasSession: false }))).toBeNull();
  });

  describe('signed out', () => {
    const out = { hasSession: false, roleCheckComplete: true, isAdmin: false };
    it('sends every admin page except login to the login page', () => {
      for (const seg of [['admin'], ['admin', 'owners'], ['admin', 'regions'], ['admin', 'reports', 'menu-health'], ['admin', 'tickets', '123']]) {
        expect(resolveAdminRoute(at(seg, out))).toBe(ADMIN_LOGIN_PATH);
      }
    });
    it('sends pages outside /admin to login too', () => {
      expect(resolveAdminRoute(at(['somewhere'], out))).toBe(ADMIN_LOGIN_PATH);
    });
    it('lets the login page be', () => {
      expect(resolveAdminRoute(at(['admin', 'login'], out))).toBeNull();
    });
  });

  describe('signed in', () => {
    it('waits while the admin check runs, on any page', () => {
      expect(resolveAdminRoute(at(['admin', 'owners'], { roleCheckComplete: false, isAdmin: false }))).toBeNull();
      expect(resolveAdminRoute(at(['somewhere'], { roleCheckComplete: false, isAdmin: false }))).toBeNull();
    });
    it('lets an admin stay on an admin page, and brings them back from outside /admin', () => {
      expect(resolveAdminRoute(at(['admin', 'owners']))).toBeNull();
      expect(resolveAdminRoute(at(['somewhere']))).toBe(ADMIN_HOME_PATH);
    });
    it('turns a signed-in non-admin away from every admin page but login', () => {
      const notAdmin = { isAdmin: false };
      expect(resolveAdminRoute(at(['admin', 'owners'], notAdmin))).toBe(ADMIN_LOGIN_PATH);
      expect(resolveAdminRoute(at(['admin'], notAdmin))).toBe(ADMIN_LOGIN_PATH);
      expect(resolveAdminRoute(at(['somewhere'], notAdmin))).toBe(ADMIN_LOGIN_PATH);
      expect(resolveAdminRoute(at(['admin', 'login'], notAdmin))).toBeNull();
    });
  });
});

describe('canShowAdminPage', () => {
  it('always shows the login page and the entry point', () => {
    expect(canShowAdminPage(at(['admin', 'login'], { hasSession: false, isAdmin: false }))).toBe(true);
    expect(canShowAdminPage(at([], { hasSession: false, isAdmin: false }))).toBe(true);
  });
  it('shows other pages only to a signed-in admin whose check has finished', () => {
    expect(canShowAdminPage(at(['admin', 'owners']))).toBe(true);
    expect(canShowAdminPage(at(['admin', 'owners'], { hasSession: false, isAdmin: false }))).toBe(false);
    expect(canShowAdminPage(at(['admin', 'owners'], { roleCheckComplete: false }))).toBe(false);
    expect(canShowAdminPage(at(['admin', 'owners'], { isAdmin: false }))).toBe(false);
  });
});

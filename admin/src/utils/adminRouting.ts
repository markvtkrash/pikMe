// Where the admin app's route guard should send the visitor, and whether a page may be drawn at all, as pure functions so the rules can be tested.
//
// Every admin page except the login page needs a signed-in ADMIN. (Before this, only pages OUTSIDE /admin were guarded, so a signed-out visitor could open
// any /admin/... page, for example by typing the address or pressing Back after logging out. The data calls were still refused by the server, but the page
// itself was shown.)
export const ADMIN_LOGIN_PATH = '/admin/login';
export const ADMIN_HOME_PATH = '/admin/claims';

export interface AdminRouteState {
  hasSession: boolean;
  // The admin check has finished for THIS session (always true when there is no session).
  roleCheckComplete: boolean;
  isAdmin: boolean;
  segments: string[];
}

function isEntryPoint(segments: string[]): boolean {
  // the bare root redirects to the login page by itself
  return segments[0] === undefined;
}

function isLoginPage(segments: string[]): boolean {
  return segments[0] === 'admin' && segments[1] === 'login';
}

// The path to redirect to, or null to stay put.
export function resolveAdminRoute(state: AdminRouteState): string | null {
  const { hasSession, roleCheckComplete, isAdmin, segments } = state;
  if (isEntryPoint(segments)) return null;

  if (!hasSession) return isLoginPage(segments) ? null : ADMIN_LOGIN_PATH;

  // do not guess while the admin check is still running
  if (!roleCheckComplete) return null;

  if (isAdmin) return segments[0] === 'admin' ? null : ADMIN_HOME_PATH;

  // signed in but not an admin (for example an owner or customer login used by mistake)
  return isLoginPage(segments) ? null : ADMIN_LOGIN_PATH;
}

// May the page itself be drawn? The login page and the entry point always; anything else only for a signed-in admin (a spinner is shown while the
// check runs, so nothing flashes on screen for someone who is not allowed to see it).
export function canShowAdminPage(state: AdminRouteState): boolean {
  if (isEntryPoint(state.segments) || isLoginPage(state.segments)) return true;
  return state.hasSession && state.roleCheckComplete && state.isAdmin;
}

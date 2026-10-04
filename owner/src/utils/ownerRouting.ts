// Where the owner app's route guard should send the user, as a pure function so
// the rules can be tested. Returns the path to redirect to, or null to stay put.
//
// Rules (in order):
//  1. Entry-point routes (the bare root and /owner) handle their own redirects.
//  2. No session and not on an auth page -> owner login.
//  3. Role check still running -> wait (null): don't guess.
//  4. A signed-in OWNER:
//     a. whose password must be changed (admin reset / admin-created account) is
//        held on the change-password page — every other route redirects there,
//        and the guard never bounces them off it. Waits (null) until the owner is
//        in the store, same as the dashboard redirect, to avoid redirect loops.
//     b. otherwise: off the auth pages (once the owner is in the store) and into
//        the restaurant area -> dashboard.
//  5. Signed in but NOT an owner -> back to the owner login.
export const OWNER_LOGIN_PATH = '/restaurant/auth/login';
export const OWNER_DASHBOARD_PATH = '/restaurant/dashboard';
export const OWNER_CHANGE_PASSWORD_PATH = '/restaurant/auth/change-password';

export interface OwnerRouteState {
  hasSession: boolean;
  roleCheckComplete: boolean;
  isRestaurantOwner: boolean;
  // The owner record has been loaded into the app's store.
  hasStoreOwner: boolean;
  mustChangePassword: boolean;
  segments: string[];
}

export function resolveOwnerRoute(state: OwnerRouteState): string | null {
  const { hasSession, roleCheckComplete, isRestaurantOwner, hasStoreOwner, mustChangePassword, segments } = state;

  const isEntryPoint = segments[0] === 'owner' || segments[0] === undefined;
  if (isEntryPoint) return null;

  const isAuthPage = segments[0] === 'restaurant' && segments[1] === 'auth';

  if (!hasSession && !isAuthPage) return OWNER_LOGIN_PATH;

  if (!roleCheckComplete) return null;

  if (isRestaurantOwner) {
    if (mustChangePassword) {
      if (!hasStoreOwner) return null;
      const onChangePasswordPage = isAuthPage && segments[2] === 'change-password';
      return onChangePasswordPage ? null : OWNER_CHANGE_PASSWORD_PATH;
    }

    const inRestaurant = segments[0] === 'restaurant';
    if (!inRestaurant || (isAuthPage && hasStoreOwner)) return OWNER_DASHBOARD_PATH;
    return null;
  }

  if (!isAuthPage) return OWNER_LOGIN_PATH;
  return null;
}

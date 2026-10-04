import {
  resolveOwnerRoute,
  OwnerRouteState,
  OWNER_LOGIN_PATH,
  OWNER_DASHBOARD_PATH,
  OWNER_CHANGE_PASSWORD_PATH,
} from './ownerRouting';

const LOGIN = ['restaurant', 'auth', 'login'];
const SIGNUP = ['restaurant', 'auth', 'signup'];
const CHANGE_PASSWORD = ['restaurant', 'auth', 'change-password'];
const DASHBOARD = ['restaurant', 'dashboard'];
const MENU = ['restaurant', 'menu'];

function state(overrides: Partial<OwnerRouteState> = {}): OwnerRouteState {
  return {
    hasSession: true,
    roleCheckComplete: true,
    isRestaurantOwner: true,
    hasStoreOwner: true,
    mustChangePassword: false,
    segments: DASHBOARD,
    ...overrides,
  };
}

describe('entry points', () => {
  it.each([[[]], [['owner']]])('leave %j alone whatever the state', (segments) => {
    expect(resolveOwnerRoute(state({ segments, hasSession: false }))).toBeNull();
    expect(resolveOwnerRoute(state({ segments, mustChangePassword: true }))).toBeNull();
    expect(resolveOwnerRoute(state({ segments, isRestaurantOwner: false }))).toBeNull();
  });
});

describe('not signed in', () => {
  // A signed-out user is never an owner and has no owner record in the store.
  const signedOut = (overrides: Partial<OwnerRouteState> = {}) =>
    state({ hasSession: false, isRestaurantOwner: false, hasStoreOwner: false, ...overrides });

  it.each([[DASHBOARD], [MENU]])('sends %j to the owner login', (segments) => {
    expect(resolveOwnerRoute(signedOut({ segments }))).toBe(OWNER_LOGIN_PATH);
  });

  it.each([[LOGIN], [SIGNUP], [CHANGE_PASSWORD]])('lets %j stay', (segments) => {
    expect(resolveOwnerRoute(signedOut({ segments }))).toBeNull();
  });

  it('does not let a stale mustChangePassword flag change that', () => {
    expect(resolveOwnerRoute(signedOut({ mustChangePassword: true, segments: DASHBOARD }))).toBe(OWNER_LOGIN_PATH);
    expect(resolveOwnerRoute(signedOut({ mustChangePassword: true, segments: LOGIN }))).toBeNull();
  });
});

describe('role check still running', () => {
  it.each([[DASHBOARD], [LOGIN], [CHANGE_PASSWORD]])('waits on %j instead of guessing', (segments) => {
    expect(resolveOwnerRoute(state({ roleCheckComplete: false, segments }))).toBeNull();
    expect(resolveOwnerRoute(state({ roleCheckComplete: false, mustChangePassword: true, segments }))).toBeNull();
  });
});

describe('signed-in owner, no password change required', () => {
  it('stays on restaurant pages', () => {
    expect(resolveOwnerRoute(state({ segments: DASHBOARD }))).toBeNull();
    expect(resolveOwnerRoute(state({ segments: MENU }))).toBeNull();
  });

  it.each([[LOGIN], [SIGNUP], [CHANGE_PASSWORD]])('is moved off the auth page %j to the dashboard', (segments) => {
    expect(resolveOwnerRoute(state({ segments }))).toBe(OWNER_DASHBOARD_PATH);
  });

  it('is moved to the dashboard from outside the restaurant area', () => {
    expect(resolveOwnerRoute(state({ segments: ['somewhere-else'] }))).toBe(OWNER_DASHBOARD_PATH);
  });

  it('is NOT bounced off an auth page until the owner is in the store (redirect-loop guard)', () => {
    expect(resolveOwnerRoute(state({ segments: LOGIN, hasStoreOwner: false }))).toBeNull();
    expect(resolveOwnerRoute(state({ segments: CHANGE_PASSWORD, hasStoreOwner: false }))).toBeNull();
  });
});

describe('signed-in owner who must change their password (e.g. after an admin reset)', () => {
  const must = (overrides: Partial<OwnerRouteState> = {}) => state({ mustChangePassword: true, ...overrides });

  it('is held on the change-password page — never bounced to the dashboard', () => {
    expect(resolveOwnerRoute(must({ segments: CHANGE_PASSWORD }))).toBeNull();
  });

  it.each([[DASHBOARD], [MENU], [LOGIN], [SIGNUP], [['restaurant', 'coupon', 'new']], [['somewhere-else']]])(
    'is sent from %j to the change-password page',
    (segments) => {
      expect(resolveOwnerRoute(must({ segments }))).toBe(OWNER_CHANGE_PASSWORD_PATH);
    }
  );

  it('waits until the owner is in the store (no redirect loop), on any route', () => {
    expect(resolveOwnerRoute(must({ hasStoreOwner: false, segments: DASHBOARD }))).toBeNull();
    expect(resolveOwnerRoute(must({ hasStoreOwner: false, segments: LOGIN }))).toBeNull();
    expect(resolveOwnerRoute(must({ hasStoreOwner: false, segments: CHANGE_PASSWORD }))).toBeNull();
  });

  it('is released as soon as the flag is cleared', () => {
    expect(resolveOwnerRoute(must({ segments: DASHBOARD }))).toBe(OWNER_CHANGE_PASSWORD_PATH);
    expect(resolveOwnerRoute(state({ mustChangePassword: false, segments: CHANGE_PASSWORD }))).toBe(
      OWNER_DASHBOARD_PATH
    );
    expect(resolveOwnerRoute(state({ mustChangePassword: false, segments: DASHBOARD }))).toBeNull();
  });

  it('only matches the exact change-password route, not other auth pages', () => {
    expect(resolveOwnerRoute(must({ segments: ['restaurant', 'auth', 'login'] }))).toBe(OWNER_CHANGE_PASSWORD_PATH);
    expect(resolveOwnerRoute(must({ segments: ['restaurant', 'auth'] }))).toBe(OWNER_CHANGE_PASSWORD_PATH);
  });
});

describe('signed in but not an owner', () => {
  it('is sent to the owner login from any non-auth page', () => {
    expect(resolveOwnerRoute(state({ isRestaurantOwner: false, segments: DASHBOARD }))).toBe(OWNER_LOGIN_PATH);
  });

  it('may stay on the auth pages', () => {
    expect(resolveOwnerRoute(state({ isRestaurantOwner: false, segments: LOGIN }))).toBeNull();
  });

  it('is never forced to change a password (that only applies to owners)', () => {
    expect(
      resolveOwnerRoute(state({ isRestaurantOwner: false, mustChangePassword: true, segments: LOGIN }))
    ).toBeNull();
    expect(
      resolveOwnerRoute(state({ isRestaurantOwner: false, mustChangePassword: true, segments: DASHBOARD }))
    ).toBe(OWNER_LOGIN_PATH);
  });
});

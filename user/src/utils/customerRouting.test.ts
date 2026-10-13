import { resolveCustomerRoute, CUSTOMER_HOME_PATH, CUSTOMER_SIGN_IN_PATH, CustomerRouteState } from './customerRouting';

const SIGN_IN = ['(auth)', 'sign-in'];
const SIGN_UP = ['(auth)', 'sign-up'];
const TABS = ['(main)', '(tabs)'];
const WELCOME = ['(onboarding)', 'welcome'];
const CUISINE = ['(onboarding)', 'cuisine-prefs'];
const FORGOT = ['(auth)', 'forgot-password'];

function state(overrides: Partial<CustomerRouteState> = {}): CustomerRouteState {
  return { hasSession: true, onboardingComplete: true, segments: TABS, ...overrides };
}

describe('not signed in', () => {
  const out = (segments: string[]) => resolveCustomerRoute(state({ hasSession: false, onboardingComplete: null, segments }));
  it('is sent to sign-in from anywhere else', () => {
    expect(out(TABS)).toBe(CUSTOMER_SIGN_IN_PATH);
    expect(out(WELCOME)).toBe(CUSTOMER_SIGN_IN_PATH);
  });
  it('stays on the sign-in page', () => {
    expect(out(SIGN_IN)).toBeNull();
    expect(out(SIGN_UP)).toBeNull();
  });
  it('can reach forgot password', () => {
    expect(out(FORGOT)).toBeNull();
  });
});

describe('forgot password', () => {
  it('is left alone once the emailed code has signed the person in', () => {
    expect(resolveCustomerRoute(state({ segments: FORGOT, onboardingComplete: false }))).toBeNull();
    expect(resolveCustomerRoute(state({ segments: FORGOT, onboardingComplete: null }))).toBeNull();
    expect(resolveCustomerRoute(state({ segments: FORGOT, onboardingComplete: true }))).toBeNull();
  });
});

describe('signed in, profile still loading', () => {
  it('waits, on any page', () => {
    for (const segments of [TABS, SIGN_IN, WELCOME]) {
      expect(resolveCustomerRoute(state({ onboardingComplete: null, segments }))).toBeNull();
    }
  });
});

describe('signed in with onboarding finished', () => {
  it('goes into the app from the sign-in pages', () => {
    expect(resolveCustomerRoute(state({ segments: SIGN_IN }))).toBe(CUSTOMER_HOME_PATH);
    expect(resolveCustomerRoute(state({ segments: SIGN_UP }))).toBe(CUSTOMER_HOME_PATH);
  });
  it('goes into the app from an onboarding screen', () => {
    expect(resolveCustomerRoute(state({ segments: WELCOME }))).toBe(CUSTOMER_HOME_PATH);
    expect(resolveCustomerRoute(state({ segments: CUISINE }))).toBe(CUSTOMER_HOME_PATH);
  });
  it('stays in the app', () => {
    expect(resolveCustomerRoute(state({ segments: TABS }))).toBeNull();
    expect(resolveCustomerRoute(state({ segments: ['restaurant', '[id]'] }))).toBeNull();
  });
});

describe('signed in with onboarding NOT finished (the new sign-up: email and password only)', () => {
  const unfinished = (segments: string[]) => resolveCustomerRoute(state({ onboardingComplete: false, segments }));
  it('goes straight into the app after signing up or in', () => {
    expect(unfinished(SIGN_UP)).toBe(CUSTOMER_HOME_PATH);
    expect(unfinished(SIGN_IN)).toBe(CUSTOMER_HOME_PATH);
  });
  it('is never forced into onboarding', () => {
    expect(unfinished(TABS)).toBeNull();
    expect(unfinished(['(main)', 'support'])).toBeNull();
    expect(unfinished(['restaurant', '[id]'])).toBeNull();
  });
  it('can stay on the onboarding screens while going through them', () => {
    expect(unfinished(WELCOME)).toBeNull();
    expect(unfinished(CUISINE)).toBeNull();
  });
});

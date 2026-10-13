// Where the customer app's route guard should send the person, as a pure function so the rules can be tested. Returns the path to go to,
// or null to stay put.
//
// Signing up needs only an email and a password. The rest of the old onboarding (food preferences, allergies, health goals) is
// optional now: a signed-in person who has not finished it goes straight into the app and is reminded later (see ProfileReminder), and is
// never forced into the onboarding screens.
//
// Rules (in order):
//  1. The forgot-password screen is left alone: checking the emailed code signs the person in, and they must stay there to set the new password.
//  2. Not signed in and not on a sign-in / sign-up page -> sign-in.
//  3. Not signed in, on one of those pages -> stay.
//  4. Signed in but the profile is still loading -> wait.
//  5. Signed in and on a sign-in / sign-up page -> into the app (whether or not onboarding was finished).
//  6. Onboarding finished and on an onboarding screen -> into the app (so finishing the flow lands in the app).
//  7. Anything else -> stay (an unfinished profile is not sent to onboarding).
export const CUSTOMER_SIGN_IN_PATH = '/(auth)/sign-in';
export const CUSTOMER_HOME_PATH = '/(main)/(tabs)';
export const ONBOARDING_START_PATH = '/(onboarding)/welcome';

export interface CustomerRouteState {
  hasSession: boolean;
  // null while the profile is loading; false when it has not been finished (or does not exist yet).
  onboardingComplete: boolean | null;
  segments: string[];
}

export function resolveCustomerRoute(state: CustomerRouteState): string | null {
  const { hasSession, onboardingComplete, segments } = state;

  if (segments.includes('forgot-password')) return null;

  const onAuthPage = segments.includes('sign-in') || segments.includes('sign-up');
  if (!hasSession) return onAuthPage ? null : CUSTOMER_SIGN_IN_PATH;

  if (onboardingComplete === null) return null;

  if (onAuthPage) return CUSTOMER_HOME_PATH;

  const inOnboarding = segments.includes('(onboarding)');
  if (inOnboarding && onboardingComplete) return CUSTOMER_HOME_PATH;

  return null;
}

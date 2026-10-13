// When to remind a signed-in person to finish setting up their food preferences. Pure, so the rules can be tested.
//
// The reminder appears when the app is opened, once per launch, for a person whose profile is not finished. It never appears on the sign-in
// pages or while they are going through the setup, never while an announcement is waiting (one window at a time), and stops for good
// once the setup is finished.
export interface ReminderState {
  hasSession: boolean;
  // null while the profile is loading; false when it has not been finished.
  onboardingComplete: boolean | null;
  segments: string[];
  // The person tapped "Not now" in this launch of the app.
  dismissedThisLaunch: boolean;
  // An admin announcement is waiting to be shown.
  announcementPending: boolean;
}

export function shouldShowProfileReminder(state: ReminderState): boolean {
  if (!state.hasSession || state.onboardingComplete !== false) return false;
  if (state.dismissedThisLaunch || state.announcementPending) return false;
  const onAuthPage = state.segments.includes('sign-in') || state.segments.includes('sign-up') || state.segments.includes('forgot-password');
  const inOnboarding = state.segments.includes('(onboarding)');
  return !onAuthPage && !inOnboarding;
}

export const REMINDER_TITLE = 'Get better recommendations';
export const REMINDER_MESSAGE =
  'Tell us your food preferences and health goals so we can recommend meals that suit you. It takes about 2 minutes, and you can keep using the app without it.';
export const REMINDER_SETUP_LABEL = 'Set up now';
export const REMINDER_LATER_LABEL = 'Not now';

// When to remind a signed-in person to finish setting up their food preferences. Pure, so the rules can be tested.
//
// The reminder appears when the app is opened for a person whose profile is not finished. "Not now" is remembered on that device for a week
// (REMINDER_SNOOZE_DAYS), so it does not nag on every visit. It never appears on the sign-in pages or while they are going through the setup,
// never while an announcement is waiting (one window at a time), and stops for good once the setup is finished.
export interface ReminderState {
  hasSession: boolean;
  // null while the profile is loading; false when it has not been finished.
  onboardingComplete: boolean | null;
  segments: string[];
  // The person tapped "Not now" within the last REMINDER_SNOOZE_DAYS (see isSnoozed).
  snoozed: boolean;
  // An admin announcement is waiting to be shown.
  announcementPending: boolean;
}

export function shouldShowProfileReminder(state: ReminderState): boolean {
  if (!state.hasSession || state.onboardingComplete !== false) return false;
  if (state.snoozed || state.announcementPending) return false;
  const onAuthPage = state.segments.includes('sign-in') || state.segments.includes('sign-up') || state.segments.includes('forgot-password');
  const inOnboarding = state.segments.includes('(onboarding)');
  return !onAuthPage && !inOnboarding;
}

export const REMINDER_SNOOZE_DAYS = 7;

// Did the person tap "Not now" less than `days` ago? `dismissedAt` is a time in milliseconds, or null when they never did.
export function isSnoozed(dismissedAt: number | null | undefined, now: number = Date.now(), days: number = REMINDER_SNOOZE_DAYS): boolean {
  if (typeof dismissedAt !== 'number' || !Number.isFinite(dismissedAt)) return false;
  const age = now - dismissedAt;
  // a time in the future (the clock was changed) does not hide the reminder for ever
  return age >= 0 && age < days * 24 * 60 * 60 * 1000;
}

export const REMINDER_TITLE = 'Get better recommendations';
export const REMINDER_MESSAGE =
  'Tell us your food preferences and health goals so we can recommend meals that suit you. It takes about 2 minutes, and you can keep using the app without it.';
export const REMINDER_SETUP_LABEL = 'Set up now';
export const REMINDER_LATER_LABEL = 'Not now';

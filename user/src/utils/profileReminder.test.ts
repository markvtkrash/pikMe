import { shouldShowProfileReminder, ReminderState, REMINDER_TITLE, REMINDER_MESSAGE } from './profileReminder';

const TABS = ['(main)', '(tabs)'];

function state(overrides: Partial<ReminderState> = {}): ReminderState {
  return { hasSession: true, onboardingComplete: false, segments: TABS, dismissedThisLaunch: false, announcementPending: false, ...overrides };
}

describe('shouldShowProfileReminder', () => {
  it('shows for a signed-in person whose profile is not finished, when the app is open', () => {
    expect(shouldShowProfileReminder(state())).toBe(true);
    expect(shouldShowProfileReminder(state({ segments: ['(main)', 'support'] }))).toBe(true);
  });

  it('does not show once the setup is finished', () => {
    expect(shouldShowProfileReminder(state({ onboardingComplete: true }))).toBe(false);
  });

  it('does not show while the profile is still loading, or when signed out', () => {
    expect(shouldShowProfileReminder(state({ onboardingComplete: null }))).toBe(false);
    expect(shouldShowProfileReminder(state({ hasSession: false }))).toBe(false);
  });

  it('does not show again in the same launch after "Not now"', () => {
    expect(shouldShowProfileReminder(state({ dismissedThisLaunch: true }))).toBe(false);
  });

  it('waits for an announcement to be dealt with first', () => {
    expect(shouldShowProfileReminder(state({ announcementPending: true }))).toBe(false);
  });

  it('does not show on the sign-in pages or while going through the setup', () => {
    for (const segments of [['(auth)', 'sign-in'], ['(auth)', 'sign-up'], ['(auth)', 'forgot-password'], ['(onboarding)', 'welcome'], ['(onboarding)', 'dietary']]) {
      expect(shouldShowProfileReminder(state({ segments }))).toBe(false);
    }
  });
});

describe('reminder wording', () => {
  it('does not mention allergies or religious dietary rules, which the app does not use', () => {
    const text = `${REMINDER_TITLE} ${REMINDER_MESSAGE}`.toLowerCase();
    for (const word of ['allerg', 'religio', 'halal', 'kosher']) expect(text).not.toContain(word);
  });
});

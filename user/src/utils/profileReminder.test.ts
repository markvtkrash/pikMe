import { shouldShowProfileReminder, ReminderState, REMINDER_TITLE, REMINDER_MESSAGE } from './profileReminder';

const TABS = ['(main)', '(tabs)'];

function state(overrides: Partial<ReminderState> = {}): ReminderState {
  return { hasSession: true, onboardingComplete: false, segments: TABS, snoozed: false, announcementPending: false, ...overrides };
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
    expect(shouldShowProfileReminder(state({ snoozed: true }))).toBe(false);
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


import { isSnoozed, REMINDER_SNOOZE_DAYS } from './profileReminder';

describe('isSnoozed', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 9, 15, 12, 0, 0);

  it('is a week', () => {
    expect(REMINDER_SNOOZE_DAYS).toBe(7);
  });
  it('hides the reminder for a week after "Not now"', () => {
    expect(isSnoozed(now - 1000, now)).toBe(true);
    expect(isSnoozed(now - 6 * DAY, now)).toBe(true);
  });
  it('lets it come back after a week', () => {
    expect(isSnoozed(now - 7 * DAY, now)).toBe(false);
    expect(isSnoozed(now - 30 * DAY, now)).toBe(false);
  });
  it('is not snoozed when they never tapped it, or the saved time is odd', () => {
    expect(isSnoozed(null, now)).toBe(false);
    expect(isSnoozed(undefined, now)).toBe(false);
    expect(isSnoozed(NaN, now)).toBe(false);
    expect(isSnoozed(now + DAY, now)).toBe(false);
  });
});

import { minimalProfile } from './profileDefaults';

describe('minimalProfile', () => {
  it('uses the part of the email before the @ as the name', () => {
    expect(minimalProfile('jane.doe@example.com').displayName).toBe('jane.doe');
  });
  it('falls back to "User" when there is no usable email', () => {
    expect(minimalProfile(null).displayName).toBe('User');
    expect(minimalProfile(undefined).displayName).toBe('User');
    expect(minimalProfile('').displayName).toBe('User');
    expect(minimalProfile('@example.com').displayName).toBe('User');
  });
  it('holds no preferences and marks onboarding unfinished, so the person is reminded later', () => {
    const p = minimalProfile('a@b.co');
    expect(p.dietaryRestrictions).toEqual([]);
    expect(p.healthGoals).toEqual([]);
    expect(p.allergens).toEqual([]);
    expect(p.cuisinePreferences).toEqual([]);
    expect(p.nutritionTargets).toEqual({});
    expect(p.onboardingComplete).toBe(false);
    expect(p.searchRadiusMeters).toBe(2000);
  });
});

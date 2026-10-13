import type { UserProfile } from '../types';

// The profile created for a person who signed up with just an email and a password and has not done the food-preferences setup.
// The profile row has to exist: saved restaurants and other per-person data point at it. Nothing in it is a preference, and onboarding
// is marked unfinished so the app reminds them later.
export function minimalProfile(email: string | null | undefined): Omit<UserProfile, 'id'> {
  const name = (email ?? '').split('@')[0].trim();
  return {
    displayName: name || 'User',
    dietaryRestrictions: [],
    healthGoals: [],
    allergens: [],
    cuisinePreferences: [],
    nutritionTargets: {},
    searchRadiusMeters: 2000,
    onboardingComplete: false,
  };
}

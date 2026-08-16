import { useUserProfileStore } from './userProfileStore';

const initialState = useUserProfileStore.getState();

beforeEach(() => {
  useUserProfileStore.setState(initialState, true);
});

describe('userProfileStore', () => {
  it('starts with an empty draft and null onboardingComplete', () => {
    const s = useUserProfileStore.getState();
    expect(s.draft).toEqual({
      displayName: '',
      description: '',
      dietaryRestrictions: [],
      healthGoals: [],
      allergens: [],
      cuisinePreferences: [],
      nutritionTargets: {},
    });
    expect(s.onboardingComplete).toBeNull();
  });

  it('updateDraft merges a partial update, preserving other fields', () => {
    useUserProfileStore.getState().updateDraft({ displayName: 'Alex' });
    useUserProfileStore.getState().updateDraft({ healthGoals: ['low_carb'] });

    const s = useUserProfileStore.getState();
    expect(s.draft.displayName).toBe('Alex');
    expect(s.draft.healthGoals).toEqual(['low_carb']);
    expect(s.draft.description).toBe('');
  });

  it('resetDraft restores the default draft', () => {
    useUserProfileStore.getState().updateDraft({ displayName: 'Alex', allergens: ['peanut'] });

    useUserProfileStore.getState().resetDraft();

    expect(useUserProfileStore.getState().draft).toEqual({
      displayName: '',
      description: '',
      dietaryRestrictions: [],
      healthGoals: [],
      allergens: [],
      cuisinePreferences: [],
      nutritionTargets: {},
    });
  });

  it('setOnboardingComplete sets true, false, and null', () => {
    useUserProfileStore.getState().setOnboardingComplete(true);
    expect(useUserProfileStore.getState().onboardingComplete).toBe(true);

    useUserProfileStore.getState().setOnboardingComplete(false);
    expect(useUserProfileStore.getState().onboardingComplete).toBe(false);

    useUserProfileStore.getState().setOnboardingComplete(null);
    expect(useUserProfileStore.getState().onboardingComplete).toBeNull();
  });
});

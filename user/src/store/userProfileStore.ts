import { create } from 'zustand';
import type { NutritionTargets } from '../types';

export interface OnboardingDraft {
  displayName: string;
  description: string;
  dietaryRestrictions: string[];
  healthGoals: string[];
  allergens: string[];
  cuisinePreferences: string[];
  nutritionTargets: NutritionTargets;
}

interface UserProfileStore {
  draft: OnboardingDraft;
  onboardingComplete: boolean | null;
  updateDraft: (partial: Partial<OnboardingDraft>) => void;
  resetDraft: () => void;
  setOnboardingComplete: (value: boolean | null) => void;
}

const defaultDraft: OnboardingDraft = {
  displayName: '',
  description: '',
  dietaryRestrictions: [],
  healthGoals: [],
  allergens: [],
  cuisinePreferences: [],
  nutritionTargets: {},
};

export const useUserProfileStore = create<UserProfileStore>((set) => ({
  draft: defaultDraft,
  onboardingComplete: null,
  updateDraft: (partial) =>
    set((state) => ({ draft: { ...state.draft, ...partial } })),
  resetDraft: () => set({ draft: defaultDraft }),
  setOnboardingComplete: (value) => set({ onboardingComplete: value }),
}));

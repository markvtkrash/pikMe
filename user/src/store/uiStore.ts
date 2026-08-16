import { create } from 'zustand';

interface UIStore {
  // In-memory only (resets on app restart) — that's the point: the nutrition
  // disclaimer should reappear once per fresh app session, not be permanently
  // dismissed like onboarding.
  hasSeenNutritionDisclaimer: boolean;
  setHasSeenNutritionDisclaimer: (seen: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  hasSeenNutritionDisclaimer: false,
  setHasSeenNutritionDisclaimer: (hasSeenNutritionDisclaimer) => set({ hasSeenNutritionDisclaimer }),
}));

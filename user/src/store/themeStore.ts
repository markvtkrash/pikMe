import { Appearance } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeThemePreference, type ThemePreference } from '../utils/themePreference';

// The person's choice of appearance, device-local (AsyncStorage). See ThemePreference: light unless they choose Dark.

// Telling React Native the choice makes useColorScheme() (and the native pieces: keyboard, status bar, system alerts) follow it.
function applyPreference(pref: ThemePreference) {
  try {
    Appearance.setColorScheme(pref);
  } catch {
    // an environment without the call keeps following the phone
  }
}

interface ThemeStore {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      preference: 'light',
      setPreference: (preference) => {
        applyPreference(preference);
        set({ preference });
      },
    }),
    {
      name: 'pikme-theme',
      storage: createJSONStorage(() => AsyncStorage),
      merge: (persisted, current) => ({ ...current, preference: normalizeThemePreference((persisted as Partial<ThemeStore> | undefined)?.preference) }),
      onRehydrateStorage: () => (state) => {
        if (state) applyPreference(state.preference);
      },
    }
  )
);

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// When the person tapped "Not now" on the profile reminder. It is kept on the device, so the reminder stays away for a week (see isSnoozed in
// utils/profileReminder.ts) instead of coming back every time the app is opened. It is cleared when they sign out, so the next person to sign in
// is reminded too, and finishing the setup ends the reminder for good.
interface ProfileReminderStore {
  dismissedAt: number | null;
  dismiss: () => void;
  reset: () => void;
}

export const useProfileReminderStore = create<ProfileReminderStore>()(
  persist(
    (set) => ({
      dismissedAt: null,
      dismiss: () => set({ dismissedAt: Date.now() }),
      reset: () => set({ dismissedAt: null }),
    }),
    {
      name: 'pikme-profile-reminder',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ dismissedAt: s.dismissedAt }),
    },
  ),
);

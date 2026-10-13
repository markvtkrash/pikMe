import { create } from 'zustand';

// Whether the person tapped "Not now" on the profile reminder in this launch of the app. It is memory only, so the reminder comes back the
// next time the app is opened, and it is cleared when they sign out so the next person to sign in sees it too.
interface ProfileReminderStore {
  dismissed: boolean;
  dismiss: () => void;
  reset: () => void;
}

export const useProfileReminderStore = create<ProfileReminderStore>((set) => ({
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
  reset: () => set({ dismissed: false }),
}));

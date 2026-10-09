import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addSeenId } from '../utils/announcements';

interface AnnouncementStore {
  // ids of the announcements this phone has already shown, so each is shown once. Device-local only.
  seenIds: string[];
  markSeen: (id: string) => void;
}

export const useAnnouncementStore = create<AnnouncementStore>()(
  persist(
    (set) => ({
      seenIds: [],
      markSeen: (id) => set((s) => ({ seenIds: addSeenId(s.seenIds, id) })),
    }),
    {
      name: 'pikme-announcements-seen',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

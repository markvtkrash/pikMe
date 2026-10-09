import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { addSeenId } from '../utils/announcements';

interface AnnouncementStore {
  // ids of the announcements this browser has already shown, so each is shown once. Browser-local only.
  seenIds: string[];
  markSeen: (id: string) => void;
}

// The owner app is a website: use the browser's localStorage, or memory when it is not available (private windows, tests).
function browserStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // blocked: fall through
  }
  const memory: Record<string, string> = {};
  return {
    getItem: (k: string) => memory[k] ?? null,
    setItem: (k: string, v: string) => { memory[k] = v; },
    removeItem: (k: string) => { delete memory[k]; },
  };
}

export const useAnnouncementStore = create<AnnouncementStore>()(
  persist(
    (set) => ({
      seenIds: [],
      markSeen: (id) => set((s) => ({ seenIds: addSeenId(s.seenIds, id) })),
    }),
    {
      name: 'pikme-owner-announcements-seen',
      storage: createJSONStorage(() => browserStorage()),
    }
  )
);

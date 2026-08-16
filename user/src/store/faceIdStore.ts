import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface FaceIdStore {
  // null = user hasn't made a choice yet — treated as "on" once the device
  // is confirmed to support Face ID/Touch ID, without forcing an explicit
  // opt-in step. Device-local only (AsyncStorage), never synced to the
  // account, since biometric lock is a property of this phone, not the user.
  requireFaceId: boolean | null;
  setRequireFaceId: (value: boolean) => void;
}

export const useFaceIdStore = create<FaceIdStore>()(
  persist(
    (set) => ({
      requireFaceId: null,
      setRequireFaceId: (requireFaceId) => set({ requireFaceId }),
    }),
    {
      name: 'pikme-face-id',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

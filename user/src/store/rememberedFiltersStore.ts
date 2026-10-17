import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NO_CATEGORY_FILTERS, type CategoryFilters } from '../utils/categories';
import { sanitizeFilters } from '../utils/rememberedFilters';

// The restaurant filters the person last chose, kept on this device (see utils/rememberedFilters.ts), and the profile choices Explore last started
// from (see planStartFilters in utils/profilePlaces.ts: when the profile is edited, Explore starts from it again). Cleared when they sign out, so the
// next person to use the phone does not start with someone else's filters.
interface RememberedFiltersStore {
  filters: CategoryFilters;
  // the profile signature (profileSignature) Explore last started from; "" when it has not started from the profile
  seededFrom: string;
  // true once the stored value has been read; Explore waits for this before deciding what to start with
  hydrated: boolean;
  remember: (filters: CategoryFilters) => void;
  // Explore started from the profile: these are now the remembered filters, and this is the profile state they came from
  seed: (filters: CategoryFilters, signature: string) => void;
  clear: () => void;
}

export const useRememberedFiltersStore = create<RememberedFiltersStore>()(
  persist(
    (set) => ({
      filters: NO_CATEGORY_FILTERS,
      seededFrom: '',
      hydrated: false,
      remember: (filters) => set({ filters: sanitizeFilters(filters) }),
      seed: (filters, signature) => set({ filters: sanitizeFilters(filters), seededFrom: signature }),
      clear: () => set({ filters: NO_CATEGORY_FILTERS, seededFrom: '' }),
    }),
    {
      name: 'pikme-remembered-filters',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ filters: s.filters, seededFrom: s.seededFrom }),
      merge: (persisted, current) => {
        const p = persisted as Partial<RememberedFiltersStore> | undefined;
        return { ...current, filters: sanitizeFilters(p?.filters), seededFrom: typeof p?.seededFrom === 'string' ? p.seededFrom : '' };
      },
      onRehydrateStorage: () => () => {
        useRememberedFiltersStore.setState({ hydrated: true });
      },
    },
  ),
);

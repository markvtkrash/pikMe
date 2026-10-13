import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeLayout, type MenuLayout } from '../utils/menuLayout';

// The person's choice between the list and the grid on a restaurant's menu. Device-local (AsyncStorage). null means no choice yet: the list ("Detailed")
// on every screen size (see resolveLayout).
interface MenuLayoutStore {
  layout: MenuLayout | null;
  setLayout: (layout: MenuLayout) => void;
}

export const useMenuLayoutStore = create<MenuLayoutStore>()(
  persist(
    (set) => ({
      layout: null,
      setLayout: (layout) => set({ layout }),
    }),
    {
      name: 'pikme-menu-layout',
      storage: createJSONStorage(() => AsyncStorage),
      // a stored value that is not one of the two layouts is ignored
      merge: (persisted, current) => ({ ...current, layout: normalizeLayout((persisted as Partial<MenuLayoutStore> | undefined)?.layout) }),
    }
  )
);

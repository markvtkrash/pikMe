import { create } from 'zustand';

interface UnsavedChangesState {
  hasUnsavedChanges: boolean;
  message: string;
  setUnsavedChanges: (hasUnsavedChanges: boolean, message?: string) => void;
}

// Global "would navigating away right now lose something" flag. Expo
// Router's Stack `beforeRemove` event only fires when a screen is actually
// removed (back navigation) — it never fires for a forward router.push() to
// a sibling screen, which is how OwnerNavHeader's top-nav links work. A
// screen with unsaved local state (e.g. Edit Menu) sets this flag while
// dirty; OwnerNavHeader checks it before every nav-link push so clicking a
// different section doesn't silently discard work.
export const useUnsavedChangesStore = create<UnsavedChangesState>((set) => ({
  hasUnsavedChanges: false,
  message: 'You have unsaved changes. Leave without saving?',
  setUnsavedChanges: (hasUnsavedChanges, message) =>
    set((state) => ({ hasUnsavedChanges, message: message ?? state.message })),
}));

// Call before any in-app navigation that might leave a screen with unsaved
// state (nav links, tab switches, etc). Returns true if it's fine to
// proceed — either nothing is unsaved, or the user confirmed leaving anyway.
export function confirmNavigationAllowed(): boolean {
  const { hasUnsavedChanges, message } = useUnsavedChangesStore.getState();
  if (!hasUnsavedChanges) return true;
  return confirm(message);
}

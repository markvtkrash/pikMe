// The app is always LIGHT: there is no Dark choice for customers (the dark palette is kept in src/theme for later). The type keeps both values
// so the dark code paths still compile.
export type ThemePreference = 'light' | 'dark';

/** Always light, including a 'dark' saved by an earlier version of the app. */
export function normalizeThemePreference(_value: unknown): ThemePreference {
  return 'light';
}

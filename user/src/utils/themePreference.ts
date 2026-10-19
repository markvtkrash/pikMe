// The person's chosen appearance: Light (default) or Dark, set from Profile.
export type ThemePreference = 'light' | 'dark';

/** A valid saved preference, else the default (light) -- an unreadable or pre-dark-mode value never breaks the app. */
export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === 'dark' ? 'dark' : 'light';
}

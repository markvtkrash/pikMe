import { normalizeThemePreference } from './themePreference';

describe('normalizeThemePreference', () => {
  it('keeps a real saved choice', () => {
    expect(normalizeThemePreference('light')).toBe('light');
    expect(normalizeThemePreference('dark')).toBe('dark');
  });
  it('falls back to light for anything else, so a bad or old value never breaks the app', () => {
    expect(normalizeThemePreference('system')).toBe('light');
    expect(normalizeThemePreference(undefined)).toBe('light');
    expect(normalizeThemePreference(null)).toBe('light');
    expect(normalizeThemePreference(123)).toBe('light');
  });
});

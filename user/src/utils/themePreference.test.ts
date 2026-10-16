import { normalizeThemePreference } from './themePreference';

describe('normalizeThemePreference', () => {
  it('is always light, even for a "dark" saved by an earlier version', () => {
    expect(normalizeThemePreference('light')).toBe('light');
    expect(normalizeThemePreference('dark')).toBe('light');
    expect(normalizeThemePreference('system')).toBe('light');
    expect(normalizeThemePreference(undefined)).toBe('light');
  });
});

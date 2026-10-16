import { useCallback, useMemo } from 'react';
import { darkColor, darkStyle, darkStyles } from './darkColors';
import { useThemeStore } from '../store/themeStore';

/** True when the screen is showing in dark mode: only when the person chose Dark in Profile. The phone's own dark setting is not followed. */
export function useIsDark(): boolean {
  const preference = useThemeStore((s) => s.preference);
  // The person's own choice is read straight from the store, so the screen switches the moment a chip is tapped.
  return preference === 'dark';
}

/** A module-level StyleSheet, translated for dark mode when it is on. Call it at the top of every component that reads the styles. */
export function useThemedStyles<T extends Record<string, any>>(base: T): T {
  const dark = useIsDark();
  return useMemo(() => (dark ? darkStyles(base) : base), [dark, base]);
}

/**
 * For colors written inline (an icon color, a placeholder, an ad hoc style object). `prop` says what the color paints: a text / icon color
 * (the default, lightened when needed) or a 'backgroundColor' / 'borderColor' surface.
 */
export function useThemeColor() {
  const dark = useIsDark();
  const color = useCallback((value: string, prop: string = 'color') => (dark ? darkColor(value, prop) : value), [dark]);
  const style = useCallback(<S,>(value: S): S => (dark ? darkStyle(value) : value), [dark]);
  return { dark, color, style };
}

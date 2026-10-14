// A password box with a Show / Hide button is a wrapper around the text box. The wrapper takes the layout part of the style the screen gave the
// text box (its margins, width and so on) so the button can sit inside the box's right edge; the text box keeps the rest (border, padding, font).
// Written without importing react-native, so it can be tested on its own.
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

const OUTER_KEYS = new Set([
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'width', 'minWidth', 'maxWidth', 'alignSelf',
]);

// A style may be an object, a list of styles, or false / null / undefined; later entries win.
function flatten(style: unknown, into: Record<string, unknown>): void {
  if (!style) return;
  if (Array.isArray(style)) {
    for (const s of style) flatten(s, into);
    return;
  }
  if (typeof style === 'object') Object.assign(into, style);
}

export function splitInputStyle(style: StyleProp<TextStyle>): { outer: ViewStyle; inner: TextStyle } {
  const flat: Record<string, unknown> = {};
  flatten(style, flat);
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    (OUTER_KEYS.has(key) ? outer : inner)[key] = value;
  }
  return { outer: outer as ViewStyle, inner: inner as TextStyle };
}

// Dark mode: the app's styles are written with light-mode colors, and each color is translated here when the phone (or the person's own choice) is on dark.
// One place to tune the dark palette, instead of a second color in every style.
//
//   neutral light colors (white, the light grays)   flip to near-black / dark grays
//   neutral dark colors used as a background        stay (they are deliberate dark surfaces: overlays, toasts)
//   light tints (the pale blue / red / orange)      flip to a dark tint of the same hue
//   saturated mid colors used as a background       stay (buttons, badges)
//   saturated colors used as text or icons          are lightened so they read on a dark surface
//   white text                                      stays white (it sits on a button or a dark surface)
//   shadows                                         stay

type Rgba = { r: number; g: number; b: number; a: number };

const TEXT_PROPS = new Set(['color', 'textDecorationColor', 'tintColor', 'placeholderTextColor']);
const KEEP_PROPS = new Set(['shadowColor', 'textShadowColor']);

const DARK_FLOOR = 0.27; // lightness of what was pure white: #454545 (a medium dark grey, not near-black)
const DARK_SPAN = 0.66; // so pure black text still becomes #ededed

function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (![3, 4, 6, 8].includes(h.length) || /[^0-9a-f]/.test(h)) return null;
    const full = h.length <= 4 ? h.split('').map((c) => c + c).join('') : h;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}

function toHsl({ r, g, b }: Rgba): { h: number; s: number; l: number } {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

function fromHsl(h: number, s: number, l: number, a: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255);
  if (a < 1) return `rgba(${to(r)}, ${to(g)}, ${to(b)}, ${Math.round(a * 1000) / 1000})`;
  return '#' + [r, g, b].map((v) => to(v).toString(16).padStart(2, '0')).join('');
}

const flip = (l: number) => DARK_FLOOR + (1 - l) * DARK_SPAN;

/** The dark-mode version of one color. `prop` is the style property it belongs to (text colors are treated differently from backgrounds). */
export function darkColor(value: string, prop: string = 'backgroundColor'): string {
  if (KEEP_PROPS.has(prop)) return value;
  const rgba = parseColor(value);
  if (!rgba || rgba.a === 0) return value;
  const { h, s, l } = toHsl(rgba);
  const neutral = s < 0.12;

  if (TEXT_PROPS.has(prop)) {
    if (neutral) return l > 0.9 ? value : fromHsl(h, s, flip(l), rgba.a);
    return l < 0.62 ? fromHsl(h, s, 0.62, rgba.a) : value;
  }
  if (neutral) return l < 0.35 ? value : fromHsl(h, s, flip(l), rgba.a);
  if (l >= 0.8) return fromHsl(h, s * 0.6, flip(l), rgba.a);
  return value;
}

/** A style object with every color translated for dark mode. Nested objects and arrays are walked; non-color values pass through. */
export function darkStyle<T>(style: T): T {
  if (Array.isArray(style)) return style.map((s) => darkStyle(s)) as unknown as T;
  if (!style || typeof style !== 'object') return style;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(style as Record<string, unknown>)) {
    if (typeof v === 'string') out[key] = /color$/i.test(key) ? darkColor(v, key) : v;
    else if (v && typeof v === 'object') out[key] = darkStyle(v);
    else out[key] = v;
  }
  return out as T;
}

/** A whole StyleSheet.create result, translated. */
export function darkStyles<T extends Record<string, any>>(styles: T): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(styles)) out[key] = darkStyle(styles[key]);
  return out as T;
}

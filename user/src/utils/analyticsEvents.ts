// Anonymous usage events (migration 147). Only the names below are sent; the server ignores anything else. Nothing personal goes in an event: no
// user ID, email, name, location or search text, just a random install ID the app makes on the phone.

export const EVENT_NAMES = [
  'app_open', 'search', 'restaurant_view', 'menu_view', 'save', 'sign_up', 'coupon_view', 'share',
  // Fired when record_user_agreement fails after a successful signup, so a missing consent row doesn't go unnoticed (see sign-in.tsx).
  'agreement_record_failed',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export function isEventName(value: unknown): value is EventName {
  return typeof value === 'string' && (EVENT_NAMES as readonly string[]).includes(value);
}

export type EventProps = Record<string, string | number | boolean>;

const MAX_KEYS = 6;
const MAX_STRING = 40;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,23}$/;

/** Small, flat details only: at most 6 keys with simple names, and values that are a short string, a finite number or a boolean. Anything else is dropped. */
export function cleanProps(props: unknown): EventProps {
  const out: EventProps = {};
  if (!props || typeof props !== 'object' || Array.isArray(props)) return out;
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (!KEY_PATTERN.test(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, MAX_STRING);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** The server accepts 8 to 64 letters, digits, "_" and "-". */
export const INSTALL_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidInstallId(value: unknown): value is string {
  return typeof value === 'string' && INSTALL_ID_PATTERN.test(value);
}

/** A new random install ID. `random` is injectable so a test can make it repeatable. */
export function newInstallId(random: () => number = Math.random, now: number = Date.now()): string {
  let s = '';
  for (let i = 0; i < 20; i++) s += Math.floor(random() * 36).toString(36);
  return `i${now.toString(36)}${s}`.slice(0, 40);
}

// Some events would be sent over and over (every search keystroke, every re-render of a page). Each is sent once per key per app launch.
// For app_open and search the key is empty (once per launch); for a restaurant or menu view it is that restaurant's place ID, so looking at
// five restaurants is five events but coming back to one is not another. The key is used here only; it is not sent.
export function createDeduper(): (event: EventName, key?: string) => boolean {
  const seen = new Set<string>();
  return (event, key = '') => {
    const id = `${event}|${key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  };
}

// Which events are sent once per launch whatever the key, and which once per key.
export const ONCE_PER_LAUNCH: readonly EventName[] = ['app_open', 'search'];

/** True when this event should be sent now (and remembers it). */
export function shouldSend(dedupe: (event: EventName, key?: string) => boolean, event: EventName, key?: string): boolean {
  return dedupe(event, ONCE_PER_LAUNCH.includes(event) ? '' : key ?? '');
}

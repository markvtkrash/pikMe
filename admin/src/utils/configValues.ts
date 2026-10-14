// Values on the admin App Config page that are simply "true" or "false" are switched with a button instead of typed in.

// True when the value is exactly the text true or false (any other value, such as 5 or hello, stays a text box).
export function isBooleanValue(value: string | null | undefined): boolean {
  return value === 'true' || value === 'false';
}

// The other one of the two.
export function nextBooleanValue(value: string): 'true' | 'false' {
  return value === 'true' ? 'false' : 'true';
}

// The question asked before switching, so a global setting is not changed by an accidental tap.
export function switchQuestion(key: string, value: string): string {
  return `Switch "${key}" from ${value} to ${nextBooleanValue(value)}? The apps pick the change up within a few minutes.`;
}

// The two switches pinned at the top of the App Config page: which kinds of restaurants customers see (migration 126).
export interface QuickSwitch {
  key: string;
  title: string;
  onText: string;
  offText: string;
}

export const QUICK_SWITCHES: QuickSwitch[] = [
  { key: 'showFranchiseRestaurants', title: 'Franchise Restaurants', onText: 'Shown to customers', offText: 'Hidden from customers' },
  { key: 'showIndependentRestaurants', title: 'Independent Restaurants', onText: 'Shown to customers', offText: 'Hidden from customers' },
];

// The question asked before turning one of these on or off, in plain words.
export function quickSwitchQuestion(sw: QuickSwitch, currentValue: string): string {
  const turningOff = currentValue === 'true';
  return turningOff
    ? `Hide all ${sw.title.toLowerCase()} from customers? The customer app picks the change up within a few minutes.`
    : `Show ${sw.title.toLowerCase()} to customers again? The customer app picks the change up within a few minutes.`;
}

// The listing-eligibility master switch (migration 139). It is NOT a plain true/false row on the list: turning it on or off affects every
// customer, so it has its own card and a window that asks for the key to be typed before the change is made.
export const LISTING_SWITCH_KEY = 'enforceListingEligibility';

// The text that must be typed to confirm (exact, spaces at the ends ignored).
export function typedConfirmationMatches(typed: string, phrase: string): boolean {
  return typed.trim() === phrase;
}

// The wording of the card, the window and the button for the current value.
export function listingSwitchText(value: string | undefined): { on: boolean; state: string; button: string; title: string; message: string } {
  const on = value === 'true';
  return on
    ? {
        on,
        state: 'ON: restaurants marked "not eligible" are hidden from customers.',
        button: 'Turn OFF',
        title: 'Turn OFF listing eligibility?',
        message: 'Every restaurant will be shown to customers again, even those marked "not eligible". The apps pick the change up within a few minutes.',
      }
    : {
        on,
        state: 'OFF: every restaurant is shown to customers, whatever its eligibility flag says.',
        button: 'Turn ON',
        title: 'Turn ON listing eligibility?',
        message: 'Restaurants marked "not eligible" will be HIDDEN from customers: from search, Saved, menus, coupons and the AI menu guess. The apps pick the change up within a few minutes.',
      };
}

// Which Google Places API the customer restaurant search calls (migration 144): a button on the Config page, not a text box. 'new' is Places API (New);
// anything else counts as the legacy API, which is also what the server does with a value it does not understand.
export const PLACES_API_KEY = 'placesApiVersion';

export function parsePlacesApi(value: string | null | undefined): 'new' | 'legacy' {
  return typeof value === 'string' && value.trim().toLowerCase() === 'new' ? 'new' : 'legacy';
}

export function nextPlacesApi(value: string | null | undefined): 'new' | 'legacy' {
  return parsePlacesApi(value) === 'new' ? 'legacy' : 'new';
}

export function placesApiText(value: string | null | undefined): { version: 'new' | 'legacy'; state: string; button: string; title: string; message: string } {
  const version = parsePlacesApi(value);
  return version === 'new'
    ? {
        version,
        state: 'NEW: the restaurant search uses Places API (New) with only the fields the app needs. A request that fails falls back to legacy by itself.',
        button: 'Switch back to legacy',
        title: 'Switch back to the legacy Places API?',
        message: 'The restaurant search goes back to the legacy Google Places API. Nothing else changes. The server picks this up within about a minute.',
      }
    : {
        version,
        state: 'LEGACY: the restaurant search uses the Places API we have always used.',
        button: 'Use the new Places API',
        title: 'Use the new Places API?',
        message: 'The restaurant search will call Places API (New): nearest 20 food places, asking Google only for the fields the app uses. If it fails, that request falls back to legacy by itself. You can switch back here at any time. Make sure "Places API (New)" is enabled for your Google key. The server picks this up within about a minute.',
      };
}

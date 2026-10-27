// Google Places API (New) for fetch-nearby-restaurants. Kept apart from index.ts so it can be unit tested.
//
// Every request names the FIELDS it wants (a field mask), and Google bills by the most expensive field asked for. We ask only for what the app uses:
//   id, displayName, location, formattedAddress, types, businessStatus, rating, currentOpeningHours, websiteUri
// Rating and opening hours put a request in the Enterprise tier, and websiteUri is in that same tier, so it adds no cost; nothing here goes above it
// (no reviews, no "serves ..." flags, no phone, no photos, no price level). The website is only cached, for the menu agent's start URL.
//
// The answer is converted into the SHAPE OF THE LEGACY API's results (place_id, geometry.location, vicinity, opening_hours.periods ...), so the code that
// builds restaurants, the cache table and the apps need no change, and a phone with an older app keeps working.

export const PLACES_API_KEY_NAME = 'placesApiVersion';
export type PlacesApiVersion = 'legacy' | 'new';

// The setting is 'new' or 'legacy'. Anything else, or nothing, is legacy: the old behaviour is the safe default.
export function parsePlacesApiVersion(value: unknown): PlacesApiVersion {
  return typeof value === 'string' && value.trim().toLowerCase() === 'new' ? 'new' : 'legacy';
}

export const NEARBY_FIELD_MASK = [
  'places.id', 'places.displayName', 'places.location', 'places.formattedAddress', 'places.types', 'places.businessStatus',
  'places.rating', 'places.currentOpeningHours', 'places.websiteUri',
].join(',');

// The single-place version of the same fields (Place Details has no "places." prefix).
export const DETAILS_FIELD_MASK = 'id,displayName,location,formattedAddress,types,businessStatus,rating,currentOpeningHours,websiteUri';

// What counts as a food place. includedTypes matches ANY of a place's types, and most restaurants list 'restaurant' among theirs. Cafes, coffee shops and
// bakeries are named because they often do not, which is why the legacy 'restaurant' filter missed places like Dunkin'.
//
// The places are asked for in TWO groups, one call each, so a downtown full of restaurants cannot fill all the slots and push every cafe and bakery out.
// To change what is asked for, edit these two lists and redeploy the function (nothing else needs to change).
export const MEAL_TYPES = ['restaurant', 'fast_food_restaurant', 'meal_takeaway', 'sandwich_shop', 'bar_and_grill'];
export const TREAT_TYPES = [
  'cafe', 'coffee_shop', 'bakery', 'ice_cream_shop', 'dessert_shop', 'donut_shop', 'juice_shop', 'bagel_shop', 'tea_house',
];
// Both groups together: the single-call version (maxResultPages = 1).
export const FOOD_TYPES = [...MEAL_TYPES, ...TREAT_TYPES];
// The two calls of the two-call version (maxResultPages = 2): up to 20 nearest places each, so up to 40 in all.
export const SEARCH_GROUPS: string[][] = [MEAL_TYPES, TREAT_TYPES];
export const NEW_API_MAX_CALLS = SEARCH_GROUPS.length;
export const NEW_API_MAX_RESULTS = 20 * NEW_API_MAX_CALLS;

// Nearby Search (New) allows a radius up to 50,000 m, and at most 20 results per call, with no "next page".
export const NEARBY_MAX_RESULTS = 20;
export const MAX_RADIUS_METERS = 50000;

// While the admin has franchises switched OFF, places whose main type is one of these are not asked for: they are almost all chains, which the server
// would only remove afterwards, wasting the slots. (Shared saved results: see the note in index.ts.)
export const CHAIN_HEAVY_PRIMARY_TYPES = ['fast_food_restaurant'];

export function buildNearbyRequest(
  latitude: number, longitude: number, radiusMeters: number, apiKey: string, types: string[] = FOOD_TYPES, excludedPrimaryTypes: string[] = [],
) {
  // a type is never both asked for and excluded
  const includedTypes = types.filter((t) => !excludedPrimaryTypes.includes(t));
  return {
    url: 'https://places.googleapis.com/v1/places:searchNearby',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': NEARBY_FIELD_MASK },
      body: JSON.stringify({
        includedTypes,
        ...(excludedPrimaryTypes.length > 0 ? { excludedPrimaryTypes } : {}),
        maxResultCount: NEARBY_MAX_RESULTS,
        // nearest first, not "most prominent" first: the nearest 20 is what a customer wants
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: { center: { latitude, longitude }, radius: Math.min(Math.max(radiusMeters, 1), MAX_RADIUS_METERS) },
        },
      }),
    },
  };
}

// The places of several calls as one list: in order, each place once (the first copy wins), at most `cap`.
// deno-lint-ignore no-explicit-any
export function mergePlaces(lists: any[][], cap: number = NEW_API_MAX_RESULTS): any[] {
  const seen = new Set<string>();
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (const list of lists) {
    for (const p of list) {
      const id = p?.place_id;
      if (typeof id !== 'string' || seen.has(id)) continue;
      seen.add(id);
      out.push(p);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

export function buildDetailsRequest(placeId: string, apiKey: string) {
  return {
    url: `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    init: { method: 'GET', headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': DETAILS_FIELD_MASK } },
  };
}

const pad2 = (n: unknown) => String(Number(n) || 0).padStart(2, '0');

// The new API's opening hours in the legacy shape: { open_now, weekday_text, periods: [{ open: { day, time: 'HHMM' }, close: { ... } }] }.
// Days are 0 (Sunday) to 6 in both. Undefined when the place has no hours.
// deno-lint-ignore no-explicit-any
export function toLegacyHours(hours: any): { open_now: boolean; weekday_text: string[]; periods: unknown[] } | undefined {
  if (!hours || typeof hours !== 'object') return undefined;
  // deno-lint-ignore no-explicit-any
  const point = (p: any) => (p && p.day != null ? { day: Number(p.day), time: `${pad2(p.hour)}${pad2(p.minute)}` } : undefined);
  const periods = (Array.isArray(hours.periods) ? hours.periods : [])
    // deno-lint-ignore no-explicit-any
    .map((p: any) => {
      const open = point(p?.open);
      if (!open) return null;
      const close = point(p?.close);
      return close ? { open, close } : { open };
    })
    .filter(Boolean);
  return {
    open_now: hours.openNow === true,
    weekday_text: Array.isArray(hours.weekdayDescriptions) ? hours.weekdayDescriptions.filter((s: unknown) => typeof s === 'string') : [],
    periods,
  };
}

// "101 Market St Suite 1, San Francisco, CA 94103, USA" -> "San Francisco". Empty when the address is not in that shape.
export function cityFromAddress(address: string | null | undefined): string {
  if (!address) return '';
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length && /^(USA|US|United States)$/i.test(parts[parts.length - 1])) parts.pop();
  if (parts.length < 2) return '';
  // the last part must be "ST" or "ST 12345"
  if (!/^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(parts[parts.length - 1])) return '';
  return parts[parts.length - 2];
}

// One place from the new API, in the legacy shape. Null when it cannot be used: no id, name or location, or it is closed for good.
// deno-lint-ignore no-explicit-any
export function toLegacyPlace(p: any): Record<string, unknown> | null {
  const lat = p?.location?.latitude;
  const lng = p?.location?.longitude;
  const name = p?.displayName?.text;
  if (typeof p?.id !== 'string' || typeof name !== 'string' || typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (p.businessStatus === 'CLOSED_PERMANENTLY') return null;
  const address = typeof p.formattedAddress === 'string' ? p.formattedAddress : '';
  return {
    place_id: p.id,
    name,
    geometry: { location: { lat, lng } },
    // the legacy answer had a short "vicinity" without a state; the full address carries the state, which the region and state filters read
    vicinity: address,
    city: cityFromAddress(address),
    rating: typeof p.rating === 'number' ? p.rating : undefined,
    types: Array.isArray(p.types) ? p.types.filter((t: unknown) => typeof t === 'string') : [],
    opening_hours: toLegacyHours(p.currentOpeningHours),
    business_status: p.businessStatus,
    website: typeof p.websiteUri === 'string' && p.websiteUri.trim() ? p.websiteUri.trim() : undefined,
  };
}

// deno-lint-ignore no-explicit-any
export function parseNearbyResponse(json: any): Record<string, unknown>[] {
  const places = Array.isArray(json?.places) ? json.places : [];
  return places.map(toLegacyPlace).filter((x: unknown): x is Record<string, unknown> => !!x);
}

// A Google error answer ({ error: { code, message, status } }) as one line for the log.
// deno-lint-ignore no-explicit-any
export function describeGoogleError(json: any, httpStatus: number): string {
  const e = json?.error;
  return e ? `${httpStatus} ${e.status ?? ''} ${e.message ?? ''}`.trim() : `HTTP ${httpStatus}`;
}

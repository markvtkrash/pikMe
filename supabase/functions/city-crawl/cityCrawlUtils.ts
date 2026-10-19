// Pure helpers for the city-crawl edge function (kept apart from index.ts so they can be unit tested).

// The searches made for every city, in order: first a general one, then one per kind of food, so a big city is covered
// beyond the ~60 results a single Google search can return. Each search is read page by page (20 a page) until Google has
// no more pages for it.
//
// This is the DEFAULT/fallback list only -- the admin's Config page (app_config key cityCrawlSearchTerms, a comma-separated
// value) is read by index.ts and passed into buildQuery/stopReasonAfterPage instead, whenever it has something in it. Kept
// here too so a missing or empty config row (before migration 158, or if an admin clears it) still searches something, and
// so the tests below have a fixed list to assert against.
export const CUISINES = [
  'American', 'Italian', 'Mexican', 'Chinese', 'Japanese', 'sushi', 'Thai', 'Indian', 'Korean', 'Vietnamese',
  'Mediterranean', 'Greek', 'Middle Eastern', 'French', 'Spanish', 'Caribbean', 'Southern', 'barbecue', 'seafood',
  'steakhouse', 'pizza', 'burger', 'sandwich', 'breakfast', 'brunch', 'vegetarian', 'vegan', 'diner', 'bakery', 'cafe',
];

export const TOTAL_QUERIES = 1 + CUISINES.length;

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PAGE_SIZE = 20;
const MAX_NAME = 200;

// "Italian restaurants in Austin, TX" for query number `index` (0 is the general search); null once the list is used up.
// `terms` defaults to the built-in list, but the caller passes the admin's configured one when there is one.
export function buildQuery(index: number, city: string, region: string, terms: string[] = CUISINES): string | null {
  const total = 1 + terms.length;
  if (!Number.isInteger(index) || index < 0 || index >= total) return null;
  const where = [city.trim(), region.trim()].filter(Boolean).join(', ');
  return index === 0 ? `restaurants in ${where}` : `${terms[index - 1]} restaurants in ${where}`;
}

export interface FoundPlace {
  place_id: string;
  name: string;
  address: string | null;
  website: string | null;
  is_open: boolean;
}

function clean(text: unknown, max: number): string {
  return typeof text === 'string' ? text.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '';
}

// The places in one Google Places (New) text-search response. A result without an id or a name is dropped; a place Google
// reports as closed (permanently or temporarily) is marked not open, and one with no status is taken as open.
export function parsePlaces(response: unknown): FoundPlace[] {
  const list = (response as { places?: unknown })?.places;
  if (!Array.isArray(list)) return [];
  const out: FoundPlace[] = [];
  for (const raw of list) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const id = typeof p.id === 'string' ? p.id : '';
    const name = clean((p.displayName as { text?: unknown } | undefined)?.text, MAX_NAME);
    if (!PLACE_ID_RE.test(id) || !name) continue;
    const status = typeof p.businessStatus === 'string' ? p.businessStatus : '';
    out.push({
      place_id: id,
      name,
      address: clean(p.formattedAddress, 300) || null,
      website: clean(p.websiteUri, 2000) || null,
      is_open: status === '' || status === 'OPERATIONAL',
    });
  }
  return out;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Does the address mention the city? A search for "Austin" can return places in nearby towns; those are left out.
export function addressInCity(address: string | null, city: string): boolean {
  const wanted = normalize(city);
  if (!wanted) return true;
  if (!address) return false;
  return ` ${normalize(address)} `.includes(` ${wanted} `);
}

// Where the search goes after this page: the next page of the same search if Google gave one, else the next search.
export function nextPosition(queryIndex: number, nextPageToken: unknown): { queryIndex: number; pageToken: string | null } {
  if (typeof nextPageToken === 'string' && nextPageToken.length > 0) return { queryIndex, pageToken: nextPageToken };
  return { queryIndex: queryIndex + 1, pageToken: null };
}

// Why the search should stop after this page, or null to go on. `callsAfterThis` counts this page's request.
// `totalQueries` defaults to the built-in list's count; the caller passes the admin's configured count when there is one.
export function stopReasonAfterPage(
  next: { queryIndex: number; pageToken: string | null }, callsAfterThis: number, callLimit: number, totalQueries: number = TOTAL_QUERIES
): 'ran_out_of_results' | 'call_limit' | null {
  if (next.queryIndex >= totalQueries && !next.pageToken) return 'ran_out_of_results';
  if (callsAfterThis >= callLimit) return 'call_limit';
  return null;
}

export type CityRequest =
  | { action: 'work' }
  | { action: 'discover'; cityId: string }
  | { action: 'fail'; cityId: string; detail: string }
  | { action: 'sync' }
  | { action: 'preview'; name: string; region: string };

// Checks what the program sent. Returns the cleaned request, or a short reason it was refused.
export function parseCityRequest(body: unknown): { ok: true; value: CityRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  switch (b.action) {
    case 'work':
      return { ok: true, value: { action: 'work' } };
    case 'sync':
      return { ok: true, value: { action: 'sync' } };
    case 'discover':
      if (typeof b.cityId !== 'string' || !UUID_RE.test(b.cityId)) return { ok: false, error: 'cityId is not valid' };
      return { ok: true, value: { action: 'discover', cityId: b.cityId } };
    case 'fail':
      if (typeof b.cityId !== 'string' || !UUID_RE.test(b.cityId)) return { ok: false, error: 'cityId is not valid' };
      return { ok: true, value: { action: 'fail', cityId: b.cityId, detail: clean(b.detail, 300) || 'failed' } };
    case 'preview': {
      const name = clean(b.name, 80);
      const region = clean(b.region, 80);
      if (name.length < 2) return { ok: false, error: 'name is required' };
      return { ok: true, value: { action: 'preview', name, region } };
    }
    default:
      return { ok: false, error: 'Unknown action' };
  }
}

// A short message for an error from Google (never includes the key).
export function describeGoogleError(status: number, body: unknown): string {
  const message = clean((body as { error?: { message?: unknown } } | null)?.error?.message, 200);
  if (status === 400 && /api key|billing/i.test(message)) return `Google refused the request (${message})`;
  if (status === 403) return `Google refused the key: ${message || 'check that Places API (New) is enabled for it'}`;
  if (status === 429) return 'Google says too many requests; will retry later';
  return `Google answered ${status}${message ? `: ${message}` : ''}`;
}

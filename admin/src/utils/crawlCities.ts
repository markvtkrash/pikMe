// Pure helpers for the admin City Imports page (Tools -> City Imports): the form rules and the wording of each city's status.

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const REGION_MAX = 80;
export const MAX_RESTAURANTS_MIN = 1;
export const MAX_RESTAURANTS_MAX = 1000;
export const DEFAULT_MAX_RESTAURANTS = 100;

export type CityStatus = 'pending' | 'discovering' | 'crawling' | 'done' | 'error' | 'needs_attention';
export type StopReason = 'reached_target' | 'ran_out_of_results' | 'call_limit' | null;

// One row of admin_list_crawl_cities (migration 134).
export interface CrawlCityRow {
  id: string;
  name: string;
  region: string;
  max_restaurants: number;
  enabled: boolean;
  status: CityStatus;
  stop_reason: StopReason;
  google_calls: number;
  google_calls_last_run: number;
  last_detail: string | null;
  places_found: number;
  queued: number;
  has_menu: number;
  no_website: number;
  franchises: number;
  not_open: number;
  reading_waiting: number;
  reading_done: number;
  reading_no_items: number;
  reading_failed: number;
  discovery_finished_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface CityForm {
  name: string;
  region: string;
  max: string;
  enabled: boolean;
}

export interface CityInput {
  name: string;
  region: string;
  max: number;
  enabled: boolean;
}

export const EMPTY_CITY_FORM: CityForm = { name: '', region: '', max: String(DEFAULT_MAX_RESTAURANTS), enabled: true };

export function formFromRow(row: CrawlCityRow): CityForm {
  return { name: row.name, region: row.region, max: String(row.max_restaurants), enabled: row.enabled };
}

// Checks the form. Returns the values to save, or the first problem in plain words.
export function buildCityInput(form: CityForm): { ok: true; value: CityInput } | { ok: false; error: string } {
  const name = form.name.trim().replace(/\s+/g, ' ');
  const region = form.region.trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN) return { ok: false, error: 'Enter the city name.' };
  if (name.length > NAME_MAX) return { ok: false, error: `The city name must be ${NAME_MAX} characters or fewer.` };
  if (region.length > REGION_MAX) return { ok: false, error: `The state or country must be ${REGION_MAX} characters or fewer.` };
  const rawMax = form.max.trim();
  if (!/^\d+$/.test(rawMax)) return { ok: false, error: 'Enter how many restaurants to find, as a whole number.' };
  const max = Number(rawMax);
  if (max < MAX_RESTAURANTS_MIN || max > MAX_RESTAURANTS_MAX) {
    return { ok: false, error: `The number of restaurants must be between ${MAX_RESTAURANTS_MIN} and ${MAX_RESTAURANTS_MAX}.` };
  }
  return { ok: true, value: { name, region, max, enabled: form.enabled } };
}

export type Tone = 'good' | 'warn' | 'info' | 'neutral';

// The badge on a city: what it is doing now.
export function describeStatus(row: Pick<CrawlCityRow, 'status' | 'enabled'>): { label: string; tone: Tone } {
  if (!row.enabled) return { label: 'Paused', tone: 'neutral' };
  switch (row.status) {
    case 'pending': return { label: 'Waiting for the next run', tone: 'neutral' };
    case 'discovering': return { label: 'Searching', tone: 'info' };
    case 'crawling': return { label: 'Reading menus', tone: 'info' };
    case 'done': return { label: 'Done', tone: 'good' };
    case 'error': return { label: 'Failed, will retry', tone: 'warn' };
    case 'needs_attention': return { label: 'Needs attention', tone: 'warn' };
    default: return { label: String(row.status), tone: 'neutral' };
  }
}

// Why the search stopped, for a city that has finished searching.
export function describeStop(reason: StopReason): string | null {
  switch (reason) {
    case 'reached_target': return 'Stopped: found the number you asked for.';
    case 'ran_out_of_results': return 'Stopped: Google has no more results for this city.';
    case 'call_limit': return 'Stopped: reached the Google request limit for one run. Run again continues the search.';
    default: return null;
  }
}

// "63 of 100 restaurants": the ones queued for menu reading plus those that already had a menu, against the target.
export function progressLine(row: Pick<CrawlCityRow, 'queued' | 'has_menu' | 'max_restaurants'>): string {
  const counted = row.queued + row.has_menu;
  return `${counted} of ${row.max_restaurants} restaurants`;
}

// What happened to the restaurants queued for menu reading.
export function readingLine(row: Pick<CrawlCityRow, 'queued' | 'reading_done' | 'reading_waiting' | 'reading_no_items' | 'reading_failed'>): string | null {
  if (row.queued === 0) return null;
  const parts = [`${row.reading_done} read`];
  if (row.reading_waiting) parts.push(`${row.reading_waiting} waiting`);
  if (row.reading_no_items) parts.push(`${row.reading_no_items} had no dishes`);
  if (row.reading_failed) parts.push(`${row.reading_failed} failed`);
  return `Menus: ${parts.join(', ')}`;
}

// Restaurants the search returned but did not queue.
export function skippedLine(row: Pick<CrawlCityRow, 'has_menu' | 'franchises' | 'no_website' | 'not_open'>): string | null {
  const parts: string[] = [];
  if (row.has_menu) parts.push(`${row.has_menu} already had a menu`);
  if (row.franchises) parts.push(`${row.franchises} ${row.franchises === 1 ? 'franchise' : 'franchises'}`);
  if (row.no_website) parts.push(`${row.no_website} with no website`);
  if (row.not_open) parts.push(`${row.not_open} closed`);
  return parts.length ? `Left out: ${parts.join(', ')}` : null;
}

// Google requests this city has used. Google's own billing is the authoritative number.
export function callsLine(row: Pick<CrawlCityRow, 'google_calls' | 'google_calls_last_run'>): string {
  const total = `${row.google_calls} Google ${row.google_calls === 1 ? 'request' : 'requests'}`;
  return row.google_calls_last_run > 0 && row.google_calls_last_run !== row.google_calls
    ? `${total} in total, ${row.google_calls_last_run} in the latest run`
    : total;
}

// A city can be run again unless it is already waiting or being searched. A paused city can be run again too; it starts when resumed.
export function canRunAgain(row: Pick<CrawlCityRow, 'status'>): boolean {
  return row.status !== 'pending' && row.status !== 'discovering';
}

export function runAgainQuestion(row: Pick<CrawlCityRow, 'name' | 'stop_reason'>): string {
  const how = row.stop_reason === 'reached_target' || row.stop_reason === 'call_limit'
    ? 'It continues the search where it stopped'
    : 'It searches again from the start for restaurants not found before';
  return `${how}, and uses more Google requests. Run ${row.name} again?`;
}

export function deleteQuestion(row: Pick<CrawlCityRow, 'name' | 'places_found'>): string {
  return `Remove ${row.name} from the list? Its ${row.places_found} found restaurants are forgotten, but menus already imported and restaurants already queued for reading are kept.`;
}

// One row of admin_list_crawl_city_places (migration 135).
export interface CityPlaceRow {
  place_id: string;
  name: string;
  address: string | null;
  website: string | null;
  outcome: 'queued' | 'has_menu' | 'no_website' | 'franchise' | 'not_open';
  crawl_status: 'pending' | 'crawling' | 'done' | 'no_items' | 'error' | 'needs_attention' | null;
  crawl_detail: string | null;
  dish_count: number;
  verified_count: number;
  found_at: string;
}

// What became of one restaurant a city found.
export function describePlace(row: Pick<CityPlaceRow, 'outcome' | 'crawl_status' | 'dish_count'>): { label: string; tone: Tone } {
  switch (row.outcome) {
    case 'has_menu': return { label: 'Already had a menu', tone: 'good' };
    case 'no_website': return { label: 'No website', tone: 'neutral' };
    case 'franchise': return { label: 'Franchise', tone: 'neutral' };
    case 'not_open': return { label: 'Closed', tone: 'neutral' };
    default: break;
  }
  switch (row.crawl_status) {
    case 'crawling': return { label: 'Being read', tone: 'info' };
    case 'done': return row.dish_count > 0 ? { label: 'Menu imported', tone: 'good' } : { label: 'Read, no dishes stored', tone: 'warn' };
    case 'no_items': return { label: 'No dishes found on the site', tone: 'warn' };
    case 'error': return { label: 'Could not read, will retry', tone: 'warn' };
    case 'needs_attention': return { label: 'Needs attention', tone: 'warn' };
    default: return { label: 'Waiting to be read', tone: 'neutral' };
  }
}

// "12 dishes (5 verified)", or null when there are none.
export function dishesLine(row: Pick<CityPlaceRow, 'dish_count' | 'verified_count'>): string | null {
  if (row.dish_count <= 0) return null;
  return `${row.dish_count} ${row.dish_count === 1 ? 'dish' : 'dishes'} (${row.verified_count} verified)`;
}

// The menu view page needs at least one stored dish to show.
export function canViewMenu(row: Pick<CityPlaceRow, 'dish_count'>): boolean {
  return row.dish_count > 0;
}

// The address of the admin menu view page (admin/app/admin/menu-view.tsx) for one restaurant.
export function menuViewParams(row: Pick<CityPlaceRow, 'name' | 'place_id' | 'address'>): { name: string; placeId: string; address: string } {
  return { name: row.name, placeId: row.place_id, address: row.address ?? '' };
}

// A short heading for the list: "Austin, TX: 85 restaurants found".
export function placesHeading(city: Pick<CrawlCityRow, 'name' | 'region'>, count: number): string {
  const where = city.region ? `${city.name}, ${city.region}` : city.name;
  return `${where}: ${count} ${count === 1 ? 'restaurant' : 'restaurants'} found`;
}

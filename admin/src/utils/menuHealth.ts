// Helpers for the admin Menu Data Health report: its Region and City choices, paging, and the link to a restaurant's menu.
import { buildCityOptions, buildStateOptions, LocationOption, LocationRow } from './menuLocation';

// The Region value the server understands as "restaurants whose address has no readable state".
export const NO_REGION = '__none__';
export const PAGE_SIZE = 50;

// One row of admin_menu_health_locations: a region and city with how many restaurants it has (state is null when unreadable).
export interface HealthLocationRow {
  state: string | null;
  city: string | null;
  restaurant_count: number;
}

function asRows(rows: HealthLocationRow[]): LocationRow[] {
  return rows.map((r) => ({ state: r.state, city: r.city, count: r.restaurant_count }));
}

// The regions to pick from, plus "No region on record" when some restaurants have none.
export function regionOptions(rows: HealthLocationRow[]): LocationOption[] {
  const options = buildStateOptions(asRows(rows));
  const none = rows.filter((r) => !(r.state ?? '').trim()).reduce((sum, r) => sum + r.restaurant_count, 0);
  return none > 0 ? [...options, { value: NO_REGION, label: 'No region on record', count: none }] : options;
}

// The cities to pick from for the chosen region. With "No region on record" there is nothing to narrow by.
export function cityOptionsFor(rows: HealthLocationRow[], region: string): LocationOption[] {
  if (region === NO_REGION) return [];
  return buildCityOptions(asRows(rows), region);
}

// The report shows nothing until a region is chosen, so it never loads the whole country by accident.
export function filterReady(region: string): boolean {
  return region.trim().length > 0;
}

// The text for a region or city filter button.
export function chosenLabel(options: LocationOption[], value: string, fallback: string): string {
  const hit = options.find((o) => o.value === value.trim().toLowerCase() || o.value === value);
  return hit ? hit.label : fallback;
}

export interface PageInfo {
  page: number;        // 0-based, kept inside the range
  pages: number;
  offset: number;
  first: number;       // 1-based number of the first row shown, 0 when none
  last: number;
}

// Where a page of rows is, given the total the server reported.
export function pageInfo(total: number, page: number, size: number = PAGE_SIZE): PageInfo {
  const pages = Math.max(1, Math.ceil(total / size));
  const safe = Math.min(Math.max(page, 0), pages - 1);
  const offset = safe * size;
  return { page: safe, pages, offset, first: total === 0 ? 0 : offset + 1, last: Math.min(offset + size, total) };
}

// The address of the admin menu view page for one restaurant of the report. An independent restaurant opens its own location's
// menu (by place ID); a franchise, or a restaurant with no place ID, opens the shared menu by name.
export function menuLinkParams(row: { restaurant_name: string; place_id?: string | null; address?: string | null; is_franchise?: boolean | null }):
  Record<string, string> {
  const params: Record<string, string> = { name: row.restaurant_name };
  if (!row.is_franchise && row.place_id) {
    params.placeId = row.place_id;
    if (row.address) params.address = row.address;
  }
  return params;
}

// The share of a restaurant's items that are verified, as a whole percentage (0 when it has none).
export function verifiedPercent(verified: number, unverified: number): number {
  const total = verified + unverified;
  return total > 0 ? Math.round((verified / total) * 100) : 0;
}

// ── Source (migration 138): claimed restaurants and restaurants found by City Imports ──────────────────────────────────────────
export type HealthSource = '' | 'claimed' | 'city';

export const SOURCE_CHOICES: { value: HealthSource; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'city', label: 'City imports' },
];

// ── Franchise vs independent (migration 151) ────────────────────────────────────────────────────────────────────────────────────
export type HealthFranchise = '' | 'franchise' | 'independent';

export const FRANCHISE_CHOICES: { value: HealthFranchise; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'franchise', label: 'Franchise' },
  { value: 'independent', label: 'Independent' },
];

export function sourceLabel(source: string | null | undefined): string {
  return source === 'city' ? 'City import' : 'Claimed';
}

// A key for a list row: a claimed restaurant has an id; a city-imported one is told apart by its place ID.
export function rowKey(row: { restaurant_id?: string | null; place_id?: string | null; restaurant_name: string; source?: string | null }): string {
  return `${row.source ?? 'claimed'}-${row.restaurant_id ?? row.place_id ?? row.restaurant_name}`;
}

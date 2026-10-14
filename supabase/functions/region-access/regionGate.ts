// Region launch control (migration 142): is a customer standing in a state that is open? Used by region-access (the customer app asks it) and by
// fetch-nearby-restaurants (so an old or altered app cannot skip the gate). The same file is kept in both function folders; a test checks they match.
//
// Order of work, cheapest first:
//   1. the master switch (enforceRegionGating): off means everyone is allowed and nothing else is done (no location lookup, no cost);
//   2. the ~1 km map square the customer is in, from the region_cells cache;
//   3. only on a cache miss, Google reverse geocoding, whose answer is then cached.
// A failure at any step lets the customer in (and is logged): an outage must not lock everyone out. A state that is known to be closed always blocks.

export interface RegionAccess {
  enforced: boolean;
  allowed: boolean;
  // live | scheduled | off | not_us | unknown (a state we do not list) | unknown_location (we could not tell where they are)
  status: string;
  stateCode: string | null;
  name: string | null;
  goLiveAt: string | null;
  // the country of the customer, when known (the waitlist is kept per place)
  countryCode: string | null;
}

export const ALLOW_ALL: RegionAccess = { enforced: false, allowed: true, status: 'live', stateCode: null, name: null, goLiveAt: null, countryCode: null };

export function validCoords(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

// One map square is about 1.1 km tall: coordinates rounded to two decimals.
export function cellKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

export interface PlaceOfPoint {
  state: string | null;
  country: string | null;
}

// Reads the state and country out of a Google Geocoding answer. Null when the answer has neither.
// deno-lint-ignore no-explicit-any
export function parseGeocode(json: any): PlaceOfPoint | null {
  const results = json?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  let state: string | null = null;
  let country: string | null = null;
  for (const r of results) {
    for (const c of r?.address_components ?? []) {
      const types: string[] = c?.types ?? [];
      if (!state && types.includes('administrative_area_level_1') && typeof c.short_name === 'string') state = c.short_name.toUpperCase();
      if (!country && types.includes('country') && typeof c.short_name === 'string') country = c.short_name.toUpperCase();
    }
  }
  return state || country ? { state, country } : null;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

// deno-lint-ignore no-explicit-any
export async function resolvePlace(supabase: any, googleKey: string | undefined, lat: number, lng: number, fetchFn: FetchLike = fetch as FetchLike): Promise<PlaceOfPoint | null> {
  const key = cellKey(lat, lng);
  try {
    const { data, error } = await supabase.rpc('region_cell_lookup', { p_cell: key });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row) return { state: row.state_code ?? null, country: row.country_code ?? null };
  } catch (e) {
    console.warn('[region] could not read the location cache:', e instanceof Error ? e.message : e);
  }
  if (!googleKey) {
    console.warn('[region] no Google key, cannot look up the state');
    return null;
  }
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=administrative_area_level_1&key=${googleKey}`;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`geocoding answered ${(res as { status?: number }).status ?? 'an error'}`);
    const json = await res.json();
    const place = parseGeocode(json);
    if (!place) return null;
    try {
      await supabase.rpc('record_region_cell', { p_cell: key, p_state: place.state, p_country: place.country });
    } catch (e) {
      console.warn('[region] could not cache the location:', e instanceof Error ? e.message : e);
    }
    return place;
  } catch (e) {
    console.warn('[region] reverse geocoding failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// deno-lint-ignore no-explicit-any
export async function checkRegion(supabase: any, googleKey: string | undefined, lat: number, lng: number, fetchFn?: FetchLike): Promise<RegionAccess> {
  try {
    const { data: enforced, error } = await supabase.rpc('region_gate_enforced');
    if (error) throw error;
    if (enforced !== true) return ALLOW_ALL;
  } catch (e) {
    console.warn('[region] could not read the region switch, letting the customer in:', e instanceof Error ? e.message : e);
    return ALLOW_ALL;
  }

  const place = await resolvePlace(supabase, googleKey, lat, lng, fetchFn);
  if (!place) {
    return { enforced: true, allowed: true, status: 'unknown_location', stateCode: null, name: null, goLiveAt: null, countryCode: null };
  }

  try {
    const { data, error } = await supabase.rpc('region_status', { p_country: place.country, p_state: place.state });
    if (error) throw error;
    return {
      enforced: true,
      allowed: data?.allowed === true,
      status: typeof data?.status === 'string' ? data.status : 'unknown',
      stateCode: data?.stateCode ?? place.state,
      name: data?.name ?? null,
      goLiveAt: data?.goLiveAt ?? null,
      countryCode: place.country,
    };
  } catch (e) {
    console.warn('[region] could not read the state status, letting the customer in:', e instanceof Error ? e.message : e);
    return { enforced: true, allowed: true, status: 'unknown_location', stateCode: place.state, name: null, goLiveAt: null, countryCode: place.country };
  }
}

// Tests for the region helper shared by the region-access and fetch-nearby-restaurants edge functions (migration 142).
import * as fs from 'fs';
import * as path from 'path';
import { ALLOW_ALL, cellKey, checkRegion, parseGeocode, resolvePlace, validCoords } from '../../../supabase/functions/region-access/regionGate';

const FN_DIR = path.resolve(__dirname, '../../../supabase/functions');

describe('the two copies of regionGate.ts', () => {
  it('are identical (one lives in each function folder)', () => {
    const a = fs.readFileSync(path.join(FN_DIR, 'region-access/regionGate.ts'), 'utf8');
    const b = fs.readFileSync(path.join(FN_DIR, 'fetch-nearby-restaurants/regionGate.ts'), 'utf8');
    expect(b).toBe(a);
  });
});

describe('cellKey and validCoords', () => {
  it('rounds to a square of about a kilometre', () => {
    expect(cellKey(37.7749, -122.4194)).toBe('37.77,-122.42');
    expect(cellKey(37.771, -122.414)).toBe(cellKey(37.774, -122.4149));
  });
  it('accepts real coordinates only', () => {
    expect(validCoords(37.7, -122.4)).toBe(true);
    expect(validCoords(0, 0)).toBe(true);
    expect(validCoords(91, 0)).toBe(false);
    expect(validCoords(0, -181)).toBe(false);
    expect(validCoords('37', '-122')).toBe(false);
    expect(validCoords(NaN, 1)).toBe(false);
    expect(validCoords(null, undefined)).toBe(false);
  });
});

describe('parseGeocode', () => {
  const kansas = { results: [{ address_components: [{ short_name: 'KS', types: ['administrative_area_level_1', 'political'] }, { short_name: 'US', types: ['country', 'political'] }] }] };
  it('reads the state and country', () => {
    expect(parseGeocode(kansas)).toEqual({ state: 'KS', country: 'US' });
  });
  it('upper-cases them', () => {
    expect(parseGeocode({ results: [{ address_components: [{ short_name: 'ks', types: ['administrative_area_level_1'] }, { short_name: 'us', types: ['country'] }] }] })).toEqual({ state: 'KS', country: 'US' });
  });
  it('gives nothing for an empty or odd answer', () => {
    expect(parseGeocode({ results: [] })).toBeNull();
    expect(parseGeocode({ status: 'ZERO_RESULTS' })).toBeNull();
    expect(parseGeocode(null)).toBeNull();
    expect(parseGeocode({ results: [{ address_components: [{ short_name: 'X', types: ['route'] }] }] })).toBeNull();
  });
});

// A fake database: rpc(name, args) answers from a table of handlers and remembers each call.
function fakeDb(handlers: Record<string, (args: any) => any>) {
  const calls: string[] = [];
  return {
    calls,
    rpc: async (name: string, args?: any) => {
      calls.push(name);
      const h = handlers[name];
      if (!h) return { data: null, error: { message: `no ${name}` } };
      const out = h(args);
      return out instanceof Error ? { data: null, error: { message: out.message } } : { data: out, error: null };
    },
  };
}

const kansasJson = { results: [{ address_components: [{ short_name: 'KS', types: ['administrative_area_level_1'] }, { short_name: 'US', types: ['country'] }] }] };
const okFetch = (json: unknown) => async () => ({ ok: true, json: async () => json });

describe('checkRegion', () => {
  it('lets everyone in, and looks nothing up, while the master switch is off', async () => {
    const db = fakeDb({ region_gate_enforced: () => false });
    const fetchFn = jest.fn(okFetch(kansasJson));
    expect(await checkRegion(db, 'key', 38, -97, fetchFn)).toEqual(ALLOW_ALL);
    expect(db.calls).toEqual(['region_gate_enforced']);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('asks Google once for a new square, caches it, then answers the state', async () => {
    const db = fakeDb({
      region_gate_enforced: () => true,
      region_cell_lookup: () => [],
      record_region_cell: () => null,
      region_status: () => ({ allowed: true, status: 'live', stateCode: 'KS', name: 'Kansas', goLiveAt: null }),
    });
    const fetchFn = jest.fn(okFetch(kansasJson));
    const r = await checkRegion(db, 'key', 38.0, -97.0, fetchFn);
    expect(r).toMatchObject({ enforced: true, allowed: true, status: 'live', stateCode: 'KS', name: 'Kansas', countryCode: 'US' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(db.calls).toEqual(['region_gate_enforced', 'region_cell_lookup', 'record_region_cell', 'region_status']);
  });

  it('uses the cached square and does not call Google', async () => {
    const db = fakeDb({
      region_gate_enforced: () => true,
      region_cell_lookup: () => [{ state_code: 'TX', country_code: 'US' }],
      region_status: () => ({ allowed: false, status: 'off', stateCode: 'TX', name: 'Texas', goLiveAt: null }),
    });
    const fetchFn = jest.fn(okFetch(kansasJson));
    const r = await checkRegion(db, 'key', 30, -97, fetchFn);
    expect(r).toMatchObject({ allowed: false, status: 'off', stateCode: 'TX' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('blocks a state that is not open, and passes on when it opens', async () => {
    const db = fakeDb({
      region_gate_enforced: () => true,
      region_cell_lookup: () => [{ state_code: 'NY', country_code: 'US' }],
      region_status: () => ({ allowed: false, status: 'scheduled', stateCode: 'NY', name: 'New York', goLiveAt: '2026-11-01T00:00:00Z' }),
    });
    const r = await checkRegion(db, 'key', 40.7, -74, okFetch(null));
    expect(r).toMatchObject({ allowed: false, status: 'scheduled', goLiveAt: '2026-11-01T00:00:00Z' });
  });

  it('lets the customer in when the state cannot be worked out', async () => {
    const down = fakeDb({ region_gate_enforced: () => true, region_cell_lookup: () => [], record_region_cell: () => null });
    const failing = async () => { throw new Error('network'); };
    expect(await checkRegion(down, 'key', 38, -97, failing as any)).toMatchObject({ enforced: true, allowed: true, status: 'unknown_location' });
    const notOk = async () => ({ ok: false, json: async () => ({}) });
    expect(await checkRegion(down, 'key', 38, -97, notOk as any)).toMatchObject({ allowed: true, status: 'unknown_location' });
    expect(await checkRegion(down, undefined, 38, -97, okFetch(kansasJson))).toMatchObject({ allowed: true, status: 'unknown_location' });
  });

  it('lets the customer in when the switch or the status cannot be read', async () => {
    const noSwitch = fakeDb({ region_gate_enforced: () => new Error('boom') });
    expect(await checkRegion(noSwitch, 'key', 38, -97, okFetch(kansasJson))).toEqual(ALLOW_ALL);
    const noStatus = fakeDb({ region_gate_enforced: () => true, region_cell_lookup: () => [{ state_code: 'KS', country_code: 'US' }], region_status: () => new Error('boom') });
    expect(await checkRegion(noStatus, 'key', 38, -97, okFetch(kansasJson))).toMatchObject({ allowed: true, status: 'unknown_location', stateCode: 'KS' });
  });

  it('does not cache an answer it could not read', async () => {
    const db = fakeDb({ region_cell_lookup: () => [], record_region_cell: () => null });
    expect(await resolvePlace(db, 'key', 38, -97, okFetch({ status: 'ZERO_RESULTS', results: [] }) as any)).toBeNull();
    expect(db.calls).toEqual(['region_cell_lookup']);
  });
});

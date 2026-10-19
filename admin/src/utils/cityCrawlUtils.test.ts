// Tests for the pure helpers of the city-crawl edge function (the city import program's door into the server).
import {
  addressInCity, buildQuery, CUISINES, describeGoogleError, nextPosition, parseCityRequest, parsePlaces, stopReasonAfterPage,
  TOTAL_QUERIES,
} from '../../../supabase/functions/city-crawl/cityCrawlUtils';

const CITY_ID = '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b';

describe('buildQuery', () => {
  it('starts with a general search, then one per kind of food', () => {
    expect(buildQuery(0, 'Austin', 'TX')).toBe('restaurants in Austin, TX');
    expect(buildQuery(1, 'Austin', 'TX')).toBe(`${CUISINES[0]} restaurants in Austin, TX`);
    expect(buildQuery(TOTAL_QUERIES - 1, 'Austin', 'TX')).toBe(`${CUISINES[CUISINES.length - 1]} restaurants in Austin, TX`);
  });
  it('trims, and leaves out a blank region', () => {
    expect(buildQuery(0, '  Austin ', '')).toBe('restaurants in Austin');
  });
  it('is null once the list is used up or the index is not valid', () => {
    expect(buildQuery(TOTAL_QUERIES, 'Austin', 'TX')).toBeNull();
    expect(buildQuery(-1, 'Austin', 'TX')).toBeNull();
    expect(buildQuery(1.5, 'Austin', 'TX')).toBeNull();
  });
  it('has no repeated kinds of food', () => {
    expect(new Set(CUISINES.map((c) => c.toLowerCase())).size).toBe(CUISINES.length);
  });
  it('searches a given term list instead of the built-in default, when one is passed (the admin\'s Config page override)', () => {
    const terms = ['Korean BBQ', 'food truck'];
    expect(buildQuery(0, 'Austin', 'TX', terms)).toBe('restaurants in Austin, TX');
    expect(buildQuery(1, 'Austin', 'TX', terms)).toBe('Korean BBQ restaurants in Austin, TX');
    expect(buildQuery(2, 'Austin', 'TX', terms)).toBe('food truck restaurants in Austin, TX');
    expect(buildQuery(3, 'Austin', 'TX', terms)).toBeNull();
  });
});

describe('parsePlaces', () => {
  const good = {
    id: 'ChIJN1t_tDeuEmsRUsoyG83frY4', displayName: { text: ' Alpha Cafe ' }, formattedAddress: '1 Main St, Austin, TX 78701, USA',
    websiteUri: 'https://alpha.example.com', businessStatus: 'OPERATIONAL',
  };
  it('reads id, name, address and website, and trims', () => {
    expect(parsePlaces({ places: [good] })).toEqual([
      { place_id: good.id, name: 'Alpha Cafe', address: good.formattedAddress, website: good.websiteUri, is_open: true },
    ]);
  });
  it('marks closed places not open, and a place with no status open', () => {
    const [closed, noStatus] = parsePlaces({ places: [{ ...good, businessStatus: 'CLOSED_PERMANENTLY' }, { ...good, id: 'ChIJ_second_place_id1', businessStatus: undefined }] });
    expect(closed.is_open).toBe(false);
    expect(noStatus.is_open).toBe(true);
  });
  it('gives null for a missing website or address', () => {
    const [p] = parsePlaces({ places: [{ id: good.id, displayName: { text: 'No Site' } }] });
    expect(p.website).toBeNull();
    expect(p.address).toBeNull();
  });
  it('drops results without a valid id or a name', () => {
    expect(parsePlaces({ places: [{ id: 'short', displayName: { text: 'X' } }, { id: good.id }, { id: good.id, displayName: { text: '  ' } }, null, 5] })).toEqual([]);
  });
  it('handles a response with no places', () => {
    expect(parsePlaces({})).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
    expect(parsePlaces({ places: 'x' })).toEqual([]);
  });
});

describe('addressInCity', () => {
  it('matches the city as a whole word, ignoring case and accents', () => {
    expect(addressInCity('1 Main St, Austin, TX 78701, USA', 'austin')).toBe(true);
    expect(addressInCity('5 Calle Uno, San José, CA', 'San Jose')).toBe(true);
  });
  it('does not match a longer name that merely contains it', () => {
    expect(addressInCity('9 Oak Rd, Austinville, VA', 'Austin')).toBe(false);
    expect(addressInCity('1 Main St, Round Rock, TX', 'Austin')).toBe(false);
  });
  it('rejects a place with no address, and accepts anything for a blank city', () => {
    expect(addressInCity(null, 'Austin')).toBe(false);
    expect(addressInCity('anywhere', '')).toBe(true);
  });
});

describe('nextPosition', () => {
  it('stays on the same search while Google has another page', () => {
    expect(nextPosition(3, 'tok')).toEqual({ queryIndex: 3, pageToken: 'tok' });
  });
  it('moves to the next search when there are no more pages', () => {
    expect(nextPosition(3, undefined)).toEqual({ queryIndex: 4, pageToken: null });
    expect(nextPosition(3, '')).toEqual({ queryIndex: 4, pageToken: null });
  });
});

describe('stopReasonAfterPage', () => {
  it('keeps going while there are searches left and requests to spend', () => {
    expect(stopReasonAfterPage({ queryIndex: 2, pageToken: null }, 5, 60)).toBeNull();
  });
  it('stops when every search is used up', () => {
    expect(stopReasonAfterPage({ queryIndex: TOTAL_QUERIES, pageToken: null }, 5, 60)).toBe('ran_out_of_results');
  });
  it('does not stop for running out while a last page is still waiting', () => {
    expect(stopReasonAfterPage({ queryIndex: TOTAL_QUERIES - 1, pageToken: 'tok' }, 5, 60)).toBeNull();
  });
  it('stops when the request limit is reached, counting this page', () => {
    expect(stopReasonAfterPage({ queryIndex: 2, pageToken: null }, 60, 60)).toBe('call_limit');
    expect(stopReasonAfterPage({ queryIndex: 2, pageToken: null }, 59, 60)).toBeNull();
  });
  it('reports running out first when both apply', () => {
    expect(stopReasonAfterPage({ queryIndex: TOTAL_QUERIES, pageToken: null }, 60, 60)).toBe('ran_out_of_results');
  });
  it('uses a given total instead of the built-in count, when one is passed (the admin\'s Config page override)', () => {
    expect(stopReasonAfterPage({ queryIndex: 3, pageToken: null }, 5, 60, 3)).toBe('ran_out_of_results');
    expect(stopReasonAfterPage({ queryIndex: 2, pageToken: null }, 5, 60, 3)).toBeNull();
  });
});

describe('parseCityRequest', () => {
  it('accepts the actions with what each needs', () => {
    expect(parseCityRequest({ action: 'work' })).toEqual({ ok: true, value: { action: 'work' } });
    expect(parseCityRequest({ action: 'sync' })).toEqual({ ok: true, value: { action: 'sync' } });
    expect(parseCityRequest({ action: 'discover', cityId: CITY_ID })).toEqual({ ok: true, value: { action: 'discover', cityId: CITY_ID } });
    expect(parseCityRequest({ action: 'fail', cityId: CITY_ID, detail: 'bad\nthing' })).toEqual({
      ok: true, value: { action: 'fail', cityId: CITY_ID, detail: 'bad thing' },
    });
    expect(parseCityRequest({ action: 'preview', name: ' Austin ', region: ' TX ' })).toEqual({
      ok: true, value: { action: 'preview', name: 'Austin', region: 'TX' },
    });
  });
  it('refuses a bad city id, a missing name, and unknown actions', () => {
    expect(parseCityRequest({ action: 'discover', cityId: 'nope' }).ok).toBe(false);
    expect(parseCityRequest({ action: 'fail' }).ok).toBe(false);
    expect(parseCityRequest({ action: 'preview', name: 'A' }).ok).toBe(false);
    expect(parseCityRequest({ action: 'drop table' }).ok).toBe(false);
    expect(parseCityRequest(null).ok).toBe(false);
  });
  it('gives a failure a default detail', () => {
    expect(parseCityRequest({ action: 'fail', cityId: CITY_ID })).toEqual({ ok: true, value: { action: 'fail', cityId: CITY_ID, detail: 'failed' } });
  });
});

describe('describeGoogleError', () => {
  it('explains the common failures without leaking a key', () => {
    expect(describeGoogleError(403, { error: { message: 'Places API (New) has not been used in project 123' } })).toMatch(/refused the key/);
    expect(describeGoogleError(403, null)).toMatch(/Places API \(New\) is enabled/);
    expect(describeGoogleError(429, null)).toMatch(/too many requests/);
    expect(describeGoogleError(400, { error: { message: 'API key not valid' } })).toMatch(/refused the request/);
    expect(describeGoogleError(500, { error: { message: 'oops' } })).toBe('Google answered 500: oops');
    expect(describeGoogleError(503, null)).toBe('Google answered 503');
  });
});

import {
  chosenLabel, cityOptionsFor, filterReady, menuLinkParams, NO_REGION, pageInfo, regionOptions, verifiedPercent, HealthLocationRow,
  SOURCE_CHOICES, sourceLabel, readStatusLabel, rowKey,
} from './menuHealth';

const rows: HealthLocationRow[] = [
  { state: 'TX', city: 'Austin', restaurant_count: 12 },
  { state: 'TX', city: 'Dallas', restaurant_count: 5 },
  { state: 'MO', city: 'St. Louis', restaurant_count: 7 },
  { state: null, city: null, restaurant_count: 4 },
];

describe('regionOptions', () => {
  it('lists each region with its restaurant count, then "No region on record"', () => {
    expect(regionOptions(rows)).toEqual([
      { value: 'mo', label: 'MO', count: 7 },
      { value: 'tx', label: 'TX', count: 17 },
      { value: NO_REGION, label: 'No region on record', count: 4 },
    ]);
  });
  it('leaves out "No region on record" when every restaurant has a region', () => {
    expect(regionOptions(rows.filter((r) => r.state)).map((o) => o.value)).toEqual(['mo', 'tx']);
  });
  it('is empty when there are no restaurants', () => {
    expect(regionOptions([])).toEqual([]);
  });
});

describe('cityOptionsFor', () => {
  it('narrows to the chosen region', () => {
    expect(cityOptionsFor(rows, 'tx')).toEqual([
      { value: 'austin', label: 'Austin', count: 12 },
      { value: 'dallas', label: 'Dallas', count: 5 },
    ]);
  });
  it('has nothing to choose for "No region on record"', () => {
    expect(cityOptionsFor(rows, NO_REGION)).toEqual([]);
  });
});

describe('filterReady', () => {
  it('needs a region', () => {
    expect(filterReady('')).toBe(false);
    expect(filterReady('  ')).toBe(false);
    expect(filterReady('tx')).toBe(true);
    expect(filterReady(NO_REGION)).toBe(true);
  });
});

describe('chosenLabel', () => {
  const options = regionOptions(rows);
  it('shows the label of the chosen option, else the fallback', () => {
    expect(chosenLabel(options, 'tx', 'Choose')).toBe('TX');
    expect(chosenLabel(options, 'TX', 'Choose')).toBe('TX');
    expect(chosenLabel(options, NO_REGION, 'Choose')).toBe('No region on record');
    expect(chosenLabel(options, '', 'Choose')).toBe('Choose');
    expect(chosenLabel(options, 'zz', 'Choose')).toBe('Choose');
  });
});

describe('pageInfo', () => {
  it('works out the range shown', () => {
    expect(pageInfo(120, 0)).toEqual({ page: 0, pages: 3, offset: 0, first: 1, last: 50 });
    expect(pageInfo(120, 2)).toEqual({ page: 2, pages: 3, offset: 100, first: 101, last: 120 });
  });
  it('keeps the page inside the range and handles no rows', () => {
    expect(pageInfo(120, 9).page).toBe(2);
    expect(pageInfo(120, -3).page).toBe(0);
    expect(pageInfo(0, 0)).toEqual({ page: 0, pages: 1, offset: 0, first: 0, last: 0 });
  });
  it('uses the size it is given', () => {
    expect(pageInfo(25, 1, 10)).toEqual({ page: 1, pages: 3, offset: 10, first: 11, last: 20 });
  });
});

describe('menuLinkParams', () => {
  it('opens an independent restaurant by its place, with the address', () => {
    expect(menuLinkParams({ restaurant_name: 'Alpha Cafe', place_id: 'ChIJabcdefghij', address: '1 Main St', is_franchise: false })).toEqual({
      name: 'Alpha Cafe', placeId: 'ChIJabcdefghij', address: '1 Main St',
    });
  });
  it('leaves the address out when there is none', () => {
    expect(menuLinkParams({ restaurant_name: 'Alpha Cafe', place_id: 'ChIJabcdefghij', address: null })).toEqual({ name: 'Alpha Cafe', placeId: 'ChIJabcdefghij' });
  });
  it('opens a franchise, or a restaurant with no place ID, by name', () => {
    expect(menuLinkParams({ restaurant_name: 'Big Burger', place_id: 'ChIJabcdefghij', is_franchise: true })).toEqual({ name: 'Big Burger' });
    expect(menuLinkParams({ restaurant_name: 'No Place', place_id: null })).toEqual({ name: 'No Place' });
  });
});

describe('verifiedPercent', () => {
  it('rounds, and is 0 with no items', () => {
    expect(verifiedPercent(30, 0)).toBe(100);
    expect(verifiedPercent(30, 14)).toBe(68);
    expect(verifiedPercent(0, 0)).toBe(0);
  });
});

describe('source', () => {
  it('offers all, claimed and city imports', () => {
    expect(SOURCE_CHOICES.map((c) => c.value)).toEqual(['', 'claimed', 'city']);
  });
  it('labels a row by where it came from', () => {
    expect(sourceLabel('city')).toBe('City import');
    expect(sourceLabel('claimed')).toBe('Claimed');
    expect(sourceLabel(null)).toBe('Claimed');
  });
});

describe('readStatusLabel', () => {
  it.each([
    ['pending', 'Waiting to be read'], [null, 'Waiting to be read'], [undefined, 'Waiting to be read'],
    ['crawling', 'Being read'], ['done', 'Read, no dishes stored'], ['no_items', 'Read, no dishes found on the site'],
    ['error', 'Could not read, will retry'], ['needs_attention', 'Needs attention'],
  ])('%s -> %s', (status, label) => {
    expect(readStatusLabel(status as string | null | undefined)).toBe(label);
  });
});

describe('rowKey', () => {
  it('uses the restaurant id for a claimed restaurant and the place id for a city import', () => {
    expect(rowKey({ restaurant_id: 'abc', place_id: 'p1', restaurant_name: 'A', source: 'claimed' })).toBe('claimed-abc');
    expect(rowKey({ restaurant_id: null, place_id: 'p1', restaurant_name: 'A', source: 'city' })).toBe('city-p1');
    expect(rowKey({ restaurant_name: 'A' })).toBe('claimed-A');
  });
  it('differs for two city imports with the same name', () => {
    expect(rowKey({ restaurant_id: null, place_id: 'p1', restaurant_name: 'Pizza', source: 'city' }))
      .not.toBe(rowKey({ restaurant_id: null, place_id: 'p2', restaurant_name: 'Pizza', source: 'city' }));
  });
});

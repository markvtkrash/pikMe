import {
  buildCityOptions, buildStateOptions, countWithoutLocation, filterButtonLabel, matchesLocation, validCity,
} from './menuLocation';

const rows = [
  { city: 'Austin', state: 'TX' },
  { city: 'austin', state: 'tx' },
  { city: 'Austin', state: 'TX' },
  { city: 'Dallas', state: 'TX' },
  { city: 'St. Louis', state: 'MO' },
  { city: 'Kansas City', state: 'MO' },
  { city: 'Portland', state: 'OR' },
  { city: 'Portland', state: 'ME' },
  { city: null, state: null },        // a franchise row
  { city: 'Nowhere', state: null },   // an address with no state
];

describe('buildStateOptions', () => {
  it('counts each region once, ignoring case, sorted by name', () => {
    expect(buildStateOptions(rows)).toEqual([
      { value: 'me', label: 'ME', count: 1 },
      { value: 'mo', label: 'MO', count: 2 },
      { value: 'or', label: 'OR', count: 1 },
      { value: 'tx', label: 'TX', count: 4 },
    ]);
  });
  it('is empty when nothing has a region', () => {
    expect(buildStateOptions([{ city: 'X', state: null }, {}])).toEqual([]);
  });
});

describe('buildCityOptions', () => {
  it('lists every city when no region is chosen, showing the most common spelling', () => {
    const options = buildCityOptions(rows, '');
    expect(options.map((o) => o.label)).toEqual(['Austin', 'Dallas', 'Kansas City', 'Nowhere', 'Portland', 'St. Louis']);
    expect(options.find((o) => o.label === 'Austin')).toEqual({ value: 'austin', label: 'Austin', count: 3 });
    expect(options.find((o) => o.label === 'Portland')?.count).toBe(2);
  });
  it('narrows to the chosen region', () => {
    expect(buildCityOptions(rows, 'MO').map((o) => o.label)).toEqual(['Kansas City', 'St. Louis']);
    expect(buildCityOptions(rows, 'tx').map((o) => o.label)).toEqual(['Austin', 'Dallas']);
    expect(buildCityOptions(rows, 'OR').map((o) => o.label)).toEqual(['Portland']);
  });
  it('is empty for a region with no restaurants', () => {
    expect(buildCityOptions(rows, 'ZZ')).toEqual([]);
  });
});

describe('matchesLocation', () => {
  it('lets everything through when no filter is set, including rows with no location', () => {
    for (const r of rows) expect(matchesLocation(r, '', '')).toBe(true);
  });
  it('filters by region, ignoring case and spaces', () => {
    expect(matchesLocation({ city: 'Austin', state: 'TX' }, ' tx ', '')).toBe(true);
    expect(matchesLocation({ city: 'Austin', state: 'TX' }, 'MO', '')).toBe(false);
  });
  it('filters by city, and by both together', () => {
    expect(matchesLocation({ city: 'Portland', state: 'OR' }, '', 'portland')).toBe(true);
    expect(matchesLocation({ city: 'Portland', state: 'ME' }, 'OR', 'Portland')).toBe(false);
    expect(matchesLocation({ city: 'Portland', state: 'OR' }, 'OR', 'Portland')).toBe(true);
  });
  it('hides a row with no city or state once a filter is on', () => {
    expect(matchesLocation({ city: null, state: null }, 'TX', '')).toBe(false);
    expect(matchesLocation({ city: null, state: null }, '', 'Austin')).toBe(false);
    expect(matchesLocation({ city: 'Nowhere', state: null }, 'TX', '')).toBe(false);
    expect(matchesLocation({ city: 'Nowhere', state: null }, '', 'Nowhere')).toBe(true);
  });
});

describe('validCity', () => {
  it('keeps a city that is in the region and drops one that is not', () => {
    expect(validCity(rows, 'TX', 'austin')).toBe('austin');
    expect(validCity(rows, 'MO', 'austin')).toBe('');
    expect(validCity(rows, '', 'Dallas')).toBe('Dallas');
    expect(validCity(rows, 'TX', '')).toBe('');
  });
});

describe('filterButtonLabel', () => {
  const options = buildStateOptions(rows);
  it('shows All or the chosen label', () => {
    expect(filterButtonLabel('Region', '', options)).toBe('Region: All');
    expect(filterButtonLabel('Region', 'tx', options)).toBe('Region: TX');
    expect(filterButtonLabel('Region', 'zz', options)).toBe('Region: All');
  });
});

describe('countWithoutLocation', () => {
  it('counts rows with neither a city nor a state', () => {
    expect(countWithoutLocation(rows)).toBe(1);
    expect(countWithoutLocation([])).toBe(0);
  });
});

describe('rows that stand for several restaurants', () => {
  const grouped = [
    { state: 'TX', city: 'Austin', count: 12 },
    { state: 'TX', city: 'austin', count: 3 },
    { state: 'TX', city: 'Dallas', count: 5 },
    { state: 'MO', city: 'St. Louis', count: 7 },
    { state: null, city: null, count: 4 },
  ];
  it('adds up their counts', () => {
    expect(buildStateOptions(grouped)).toEqual([
      { value: 'mo', label: 'MO', count: 7 },
      { value: 'tx', label: 'TX', count: 20 },
    ]);
    expect(buildCityOptions(grouped, 'TX')).toEqual([
      { value: 'austin', label: 'Austin', count: 15 },
      { value: 'dallas', label: 'Dallas', count: 5 },
    ]);
    expect(countWithoutLocation(grouped)).toBe(4);
  });
  it('treats a missing, zero or negative count as one', () => {
    expect(buildStateOptions([{ state: 'TX', count: 0 }, { state: 'TX', count: -2 }, { state: 'TX' }])).toEqual([{ value: 'tx', label: 'TX', count: 3 }]);
  });
});

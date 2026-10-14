import {
  describeGoLive, filterRegions, goLiveInputValue, matchesFilter, parseGoLive, parseRegions, readinessWarning, regionCounts, regionSwitchText,
  REGION_SWITCH_KEY, statusLabel, TURN_OFF_ALL_PHRASE,
} from './regions';

const rows = [
  { state_code: 'KS', name: 'Kansas', status: 'live', go_live_at: null, note: 'first', is_open: true, waitlist_count: '0', restaurant_count: '120', with_menu_count: '90', updated_at: '2026-10-13T00:00:00Z' },
  { state_code: 'MO', name: 'Missouri', status: 'scheduled', go_live_at: '2999-01-01T00:00:00Z', note: '  ', is_open: false, waitlist_count: 12, restaurant_count: 5, with_menu_count: 1, updated_at: null },
  { state_code: 'NE', name: 'Nebraska', status: 'scheduled', go_live_at: '2020-01-01T00:00:00Z', note: null, is_open: true, waitlist_count: 3, restaurant_count: 40, with_menu_count: 40, updated_at: null },
  { state_code: 'TX', name: 'Texas', status: 'off', go_live_at: null, note: null, is_open: false, waitlist_count: 50, restaurant_count: 0, with_menu_count: 0, updated_at: null },
  { state_code: 'XX', name: 'Odd', status: 'weird', go_live_at: 5, note: 7, is_open: 'yes', waitlist_count: 'x', restaurant_count: null },
  { bad: true },
];

describe('parseRegions', () => {
  const regions = parseRegions(rows);
  it('reads the rows and skips the broken ones', () => {
    expect(regions.map((r) => r.stateCode)).toEqual(['KS', 'MO', 'NE', 'TX', 'XX']);
    expect(parseRegions(null)).toEqual([]);
    expect(parseRegions('x')).toEqual([]);
  });
  it('turns numbers sent as text into numbers, and blank notes into none', () => {
    expect(regions[0]).toMatchObject({ waitlistCount: 0, restaurantCount: 120, withMenuCount: 90, note: 'first', isOpen: true });
    expect(regions[1].note).toBeNull();
  });
  it('treats an odd status as off and odd values as empty', () => {
    expect(regions[4]).toMatchObject({ status: 'off', goLiveAt: null, note: null, isOpen: false, waitlistCount: 0, restaurantCount: 0 });
  });
});

describe('status, filters and counts', () => {
  const regions = parseRegions(rows);
  it('says Live for a state that is open, even a scheduled one whose time has passed', () => {
    expect(regions.map(statusLabel)).toEqual(['Live', 'Scheduled', 'Live', 'Off', 'Off']);
  });
  it('filters by what customers get', () => {
    expect(regions.filter((r) => matchesFilter(r, 'live')).map((r) => r.stateCode)).toEqual(['KS', 'NE']);
    expect(regions.filter((r) => matchesFilter(r, 'scheduled')).map((r) => r.stateCode)).toEqual(['MO']);
    expect(regions.filter((r) => matchesFilter(r, 'off')).map((r) => r.stateCode)).toEqual(['TX', 'XX']);
    expect(filterRegions(regions, 'all', '')).toHaveLength(5);
  });
  it('searches by name or exact state code', () => {
    expect(filterRegions(regions, 'all', 'kan').map((r) => r.stateCode)).toEqual(['KS']);
    expect(filterRegions(regions, 'all', 'tx').map((r) => r.stateCode)).toEqual(['TX']);
    expect(filterRegions(regions, 'live', 'tex')).toEqual([]);
  });
  it('counts', () => {
    expect(regionCounts(regions)).toEqual({ all: 5, live: 2, scheduled: 1, off: 2, waitlist: 65 });
  });
});

describe('readinessWarning', () => {
  it('warns about a thin state and stays quiet about a ready one', () => {
    expect(readinessWarning({ restaurantCount: 0, withMenuCount: 0 })).toMatch(/No restaurants/);
    expect(readinessWarning({ restaurantCount: 1, withMenuCount: 1 })).toBe('Only 1 restaurant found here.');
    expect(readinessWarning({ restaurantCount: 19, withMenuCount: 19 })).toBe('Only 19 restaurants found here.');
    expect(readinessWarning({ restaurantCount: 100, withMenuCount: 40 })).toBe('Only 40 of 100 restaurants have a menu.');
    expect(readinessWarning({ restaurantCount: 100, withMenuCount: 50 })).toBeNull();
  });
});

describe('go-live time', () => {
  it('reads a typed date and time as the admin\'s own time', () => {
    const iso = parseGoLive('2026-11-01 09:30')!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 11, 1, 9, 30]);
    expect(parseGoLive(' 2026-11-01T09:30 ')).toBe(iso);
  });
  it('refuses what is not a real date and time', () => {
    for (const bad of ['', 'soon', '2026-13-01 09:00', '2026-02-30 09:00', '2026-11-01 25:00', '2026-11-01', '11/01/2026 09:00']) {
      expect(parseGoLive(bad)).toBeNull();
    }
  });
  it('round-trips into the text box', () => {
    expect(goLiveInputValue(parseGoLive('2026-11-01 09:30'))).toBe('2026-11-01 09:30');
    expect(goLiveInputValue(null)).toBe('');
    expect(goLiveInputValue('nonsense')).toBe('');
    expect(describeGoLive(null)).toBe('');
    expect(describeGoLive('2026-11-01T09:30:00Z')).not.toBe('');
  });
});

describe('master switch wording', () => {
  it('is the enforceRegionGating key', () => {
    expect(REGION_SWITCH_KEY).toBe('enforceRegionGating');
    expect(TURN_OFF_ALL_PHRASE).toBe('turn off all regions');
  });
  it('words each state', () => {
    expect(regionSwitchText('false')).toMatchObject({ on: false, button: 'Turn ON' });
    expect(regionSwitchText('false').message).toMatch(/Coming soon/);
    expect(regionSwitchText('true')).toMatchObject({ on: true, button: 'Turn OFF' });
    expect(regionSwitchText(undefined).on).toBe(false);
  });
});

import {
  buildCityInput, callsLine, canRunAgain, deleteQuestion, describeStatus, describeStop, EMPTY_CITY_FORM, formFromRow, progressLine,
  readingLine, runAgainQuestion, skippedLine, CrawlCityRow, CityPlaceRow, describePlace, dishesLine, canViewMenu, menuViewParams, placesHeading,
} from './crawlCities';

function row(overrides: Partial<CrawlCityRow> = {}): CrawlCityRow {
  return {
    id: 'c1', name: 'Austin', region: 'TX', max_restaurants: 100, enabled: true, status: 'done', stop_reason: 'reached_target',
    google_calls: 37, google_calls_last_run: 12, last_detail: null, places_found: 150, queued: 80, has_menu: 5, no_website: 30,
    franchises: 25, not_open: 10, reading_waiting: 8, reading_done: 60, reading_no_items: 7, reading_failed: 5,
    discovery_finished_at: null, finished_at: null, created_at: '2026-10-12T00:00:00Z', ...overrides,
  };
}

describe('buildCityInput', () => {
  const form = (o: Partial<typeof EMPTY_CITY_FORM> = {}) => ({ ...EMPTY_CITY_FORM, name: 'Austin', region: 'TX', ...o });

  it('starts with 100 restaurants and the city switched on', () => {
    expect(EMPTY_CITY_FORM).toEqual({ name: '', region: '', max: '100', enabled: true });
  });
  it('accepts a valid city and tidies the spaces', () => {
    expect(buildCityInput(form({ name: '  San   Antonio ', region: ' TX ', max: ' 250 ' }))).toEqual({
      ok: true, value: { name: 'San Antonio', region: 'TX', max: 250, enabled: true },
    });
  });
  it('allows a blank state or country', () => {
    expect(buildCityInput(form({ region: '' }))).toEqual({ ok: true, value: { name: 'Austin', region: '', max: 100, enabled: true } });
  });
  it('needs a city name', () => {
    expect(buildCityInput(form({ name: ' ' }))).toEqual({ ok: false, error: 'Enter the city name.' });
    expect(buildCityInput(form({ name: 'A' })).ok).toBe(false);
  });
  it('refuses names and regions that are too long', () => {
    expect(buildCityInput(form({ name: 'x'.repeat(81) })).ok).toBe(false);
    expect(buildCityInput(form({ region: 'x'.repeat(81) })).ok).toBe(false);
  });
  it('needs a whole number of restaurants from 1 to 1000', () => {
    for (const bad of ['', 'abc', '12.5', '-3', '0', '1001', '1e3']) expect(buildCityInput(form({ max: bad })).ok).toBe(false);
    for (const good of ['1', '1000', '100']) expect(buildCityInput(form({ max: good })).ok).toBe(true);
  });
  it('keeps the switch', () => {
    expect(buildCityInput(form({ enabled: false }))).toEqual({ ok: true, value: { name: 'Austin', region: 'TX', max: 100, enabled: false } });
  });
});

describe('formFromRow', () => {
  it('fills the form from a city', () => {
    expect(formFromRow(row({ max_restaurants: 40, enabled: false }))).toEqual({ name: 'Austin', region: 'TX', max: '40', enabled: false });
  });
});

describe('describeStatus', () => {
  it.each([
    ['pending', 'Waiting for the next run', 'neutral'],
    ['discovering', 'Searching', 'info'],
    ['crawling', 'Reading menus', 'info'],
    ['done', 'Done', 'good'],
    ['error', 'Failed, will retry', 'warn'],
    ['needs_attention', 'Needs attention', 'warn'],
  ] as const)('%s', (status, label, tone) => {
    expect(describeStatus({ status, enabled: true })).toEqual({ label, tone });
  });
  it('a switched-off city is paused whatever its status', () => {
    expect(describeStatus({ status: 'done', enabled: false })).toEqual({ label: 'Paused', tone: 'neutral' });
  });
});

describe('describeStop', () => {
  it('says why the search stopped', () => {
    expect(describeStop('reached_target')).toMatch(/found the number/);
    expect(describeStop('ran_out_of_results')).toMatch(/no more results/);
    expect(describeStop('call_limit')).toMatch(/Run again continues/);
    expect(describeStop(null)).toBeNull();
  });
});

describe('progress and detail lines', () => {
  it('counts queued restaurants and ones that already had a menu against the target', () => {
    expect(progressLine(row())).toBe('85 of 100 restaurants');
  });
  it('summarises the menu reading, leaving out zeros', () => {
    expect(readingLine(row())).toBe('Menus: 60 read, 8 waiting, 7 had no dishes, 5 failed');
    expect(readingLine(row({ reading_waiting: 0, reading_no_items: 0, reading_failed: 0 }))).toBe('Menus: 60 read');
    expect(readingLine(row({ queued: 0 }))).toBeNull();
  });
  it('lists what was left out, leaving out zeros and pluralising', () => {
    expect(skippedLine(row())).toBe('Left out: 5 already had a menu, 25 franchises, 30 with no website, 10 closed');
    expect(skippedLine(row({ has_menu: 0, no_website: 0, not_open: 0, franchises: 1 }))).toBe('Left out: 1 franchise');
    expect(skippedLine(row({ has_menu: 0, no_website: 0, not_open: 0, franchises: 0 }))).toBeNull();
  });
  it('shows the Google request counts', () => {
    expect(callsLine(row())).toBe('37 Google requests in total, 12 in the latest run');
    expect(callsLine(row({ google_calls: 1, google_calls_last_run: 1 }))).toBe('1 Google request');
    expect(callsLine(row({ google_calls: 0, google_calls_last_run: 0 }))).toBe('0 Google requests');
  });
});

describe('actions', () => {
  it('a city can be run again unless it is waiting or being searched', () => {
    expect(canRunAgain({ status: 'done' })).toBe(true);
    expect(canRunAgain({ status: 'crawling' })).toBe(true);
    expect(canRunAgain({ status: 'error' })).toBe(true);
    expect(canRunAgain({ status: 'needs_attention' })).toBe(true);
    expect(canRunAgain({ status: 'pending' })).toBe(false);
    expect(canRunAgain({ status: 'discovering' })).toBe(false);
  });
  it('explains what running again does', () => {
    expect(runAgainQuestion({ name: 'Austin', stop_reason: 'reached_target' })).toMatch(/continues the search where it stopped/);
    expect(runAgainQuestion({ name: 'Austin', stop_reason: 'ran_out_of_results' })).toMatch(/from the start/);
    expect(runAgainQuestion({ name: 'Austin', stop_reason: null })).toMatch(/Run Austin again\?/);
  });
  it('says what removing a city keeps', () => {
    expect(deleteQuestion({ name: 'Austin', places_found: 150 })).toMatch(/Austin.*150 found restaurants.*already imported/);
  });
});

describe('describePlace', () => {
  const place = (o: Partial<CityPlaceRow> = {}): CityPlaceRow => ({
    place_id: 'ChIJabcdefghij', name: 'Alpha Cafe', address: '1 Main St', website: 'https://a.example.com', outcome: 'queued',
    crawl_status: null, crawl_detail: null, dish_count: 0, verified_count: 0, found_at: '2026-10-12T00:00:00Z', ...o,
  });
  it.each([
    ['has_menu', 'Already had a menu'], ['no_website', 'No website'], ['franchise', 'Franchise'], ['not_open', 'Closed'],
  ] as const)('%s restaurants are labelled by why they were left out', (outcome, label) => {
    expect(describePlace(place({ outcome, crawl_status: 'done', dish_count: 9 })).label).toBe(label);
  });
  it('follows the crawler for queued restaurants', () => {
    expect(describePlace(place()).label).toBe('Waiting to be read');
    expect(describePlace(place({ crawl_status: 'pending' })).label).toBe('Waiting to be read');
    expect(describePlace(place({ crawl_status: 'crawling' }))).toEqual({ label: 'Being read', tone: 'info' });
    expect(describePlace(place({ crawl_status: 'done', dish_count: 12 }))).toEqual({ label: 'Menu imported', tone: 'good' });
    expect(describePlace(place({ crawl_status: 'done', dish_count: 0 })).label).toBe('Read, no dishes stored');
    expect(describePlace(place({ crawl_status: 'no_items' })).label).toBe('No dishes found on the site');
    expect(describePlace(place({ crawl_status: 'error' })).label).toBe('Could not read, will retry');
    expect(describePlace(place({ crawl_status: 'needs_attention' })).tone).toBe('warn');
  });
  it('shows dishes only when there are some, and allows viewing only then', () => {
    expect(dishesLine({ dish_count: 12, verified_count: 5 })).toBe('12 dishes (5 verified)');
    expect(dishesLine({ dish_count: 1, verified_count: 1 })).toBe('1 dish (1 verified)');
    expect(dishesLine({ dish_count: 0, verified_count: 0 })).toBeNull();
    expect(canViewMenu({ dish_count: 1 })).toBe(true);
    expect(canViewMenu({ dish_count: 0 })).toBe(false);
  });
  it('builds the menu view address, with a blank address when there is none', () => {
    expect(menuViewParams({ name: 'Alpha Cafe', place_id: 'ChIJabcdefghij', address: '1 Main St' })).toEqual({ name: 'Alpha Cafe', placeId: 'ChIJabcdefghij', address: '1 Main St' });
    expect(menuViewParams({ name: 'X', place_id: 'ChIJabcdefghij', address: null }).address).toBe('');
  });
  it('writes the heading', () => {
    expect(placesHeading({ name: 'Austin', region: 'TX' }, 85)).toBe('Austin, TX: 85 restaurants found');
    expect(placesHeading({ name: 'Austin', region: '' }, 1)).toBe('Austin: 1 restaurant found');
  });
});

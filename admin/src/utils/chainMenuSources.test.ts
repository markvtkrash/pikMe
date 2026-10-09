import {
  ChainMenuSource, describeCheckState, filterSources, formatChecked, isMarkedDue, markedDueTimestamp, needsAttention, needsStore, parseSearchMiles, parseSourceFilter, validatePlaceIdInput, statusInfo, summarizeSources, validateMenuLinkInput,
} from './chainMenuSources';

const row = (over: Partial<ChainMenuSource>): ChainMenuSource => ({
  chain_id: 'id', chain_name: 'Taco Bell', category: 'Mexican', status: 'ok', status_detail: null, menu_link: null,
  store_ref: null, menu_link_manual: false, website: null, item_count: 0, fetched_at: null, current_items: 0, built_in_menu_url: null, ...over,
});

describe('validateMenuLinkInput', () => {
  it('accepts a normal link, with or without a store parameter', () => {
    expect(validateMenuLinkInput('https://www.tacobell.com/food', '')).toBeNull();
    expect(validateMenuLinkInput('http://x.com/menu', 'store=034416')).toBeNull();
    expect(validateMenuLinkInput('  https://x.com/menu  ', '  unitNum=1696  ')).toBeNull();
  });

  it('allows a blank link, which clears the manual link', () => {
    expect(validateMenuLinkInput('', '')).toBeNull();
    expect(validateMenuLinkInput('   ', 'ignored')).toBeNull();
  });

  it('rejects anything that is not a full web address', () => {
    for (const bad of ['tacobell.com/food', 'ftp://x.com/menu', 'javascript:alert(1)', 'https://', 'https://nodot', 'words']) {
      expect(validateMenuLinkInput(bad, '')).toMatch(/web address/);
    }
  });

  it('rejects spaces inside the link and over-long links', () => {
    expect(validateMenuLinkInput('https://x.com/my menu', '')).toMatch(/spaces/);
    expect(validateMenuLinkInput('just words', '')).toMatch(/spaces/);
    expect(validateMenuLinkInput('https://x.com/' + 'a'.repeat(2000), '')).toMatch(/too long/);
  });

  it('rejects an unsafe store parameter', () => {
    expect(validateMenuLinkInput('https://x.com/menu', 'store=1; DROP')).toMatch(/store parameter/);
    expect(validateMenuLinkInput('https://x.com/menu', 'a'.repeat(201))).toMatch(/store parameter/);
  });
});

describe('statusInfo / needsAttention', () => {
  it('labels each outcome and marks failures as bad', () => {
    expect(statusInfo({ status: 'ok', menu_link_manual: false })).toEqual({ label: 'OK', tone: 'good' });
    expect(statusInfo({ status: 'ok', menu_link_manual: true }).label).toBe('OK · manual link');
    for (const status of ['no_menu_link', 'unreadable', 'error']) expect(statusInfo({ status, menu_link_manual: false }).tone).toBe('bad');
    expect(statusInfo({ status: 'pending', menu_link_manual: true }).tone).toBe('neutral');
    expect(statusInfo({ status: 'not_started', menu_link_manual: false }).tone).toBe('neutral');
    expect(statusInfo({ status: 'weird', menu_link_manual: false })).toEqual({ label: 'weird', tone: 'neutral' });
  });

  it('flags only failed lookups as needing attention', () => {
    expect(['no_menu_link', 'unreadable', 'error'].every((status) => needsAttention({ status }))).toBe(true);
    expect(['ok', 'pending', 'not_started'].some((status) => needsAttention({ status }))).toBe(false);
  });
});

describe('filterSources / summarizeSources', () => {
  const rows = [
    row({ chain_id: '1', chain_name: 'Taco Bell', status: 'ok', menu_link_manual: true }),
    row({ chain_id: '2', chain_name: 'Dunkin\'', category: 'Coffee', status: 'no_menu_link' }),
    row({ chain_id: '3', chain_name: 'Wingstop', category: 'Chicken', status: 'unreadable' }),
    row({ chain_id: '4', chain_name: 'Subway', category: 'Sandwiches', status: 'not_started' }),
    row({ chain_id: '5', chain_name: 'Panera Bread', category: 'Bakery', status: 'ok' }),
    // looked up before, then marked for a fresh lookup
    row({ chain_id: '6', chain_name: 'Jinkies', category: 'Pizza', status: 'ok', fetched_at: markedDueTimestamp() }),
  ];
  const ids = (r: ChainMenuSource[]) => r.map((x) => x.chain_id);

  it('filters by outcome', () => {
    expect(ids(filterSources(rows, 'all', ''))).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(ids(filterSources(rows, 'attention', ''))).toEqual(['2', '3']);
    expect(ids(filterSources(rows, 'ok', ''))).toEqual(['1', '5', '6']);
    expect(ids(filterSources(rows, 'manual', ''))).toEqual(['1']);
    expect(ids(filterSources(rows, 'none', ''))).toEqual(['4']);
  });

  it('"due" lists chains marked for a fresh lookup, not ones never looked up or recently checked', () => {
    expect(ids(filterSources(rows, 'due', ''))).toEqual(['6']);
    const recent = row({ chain_id: '7', fetched_at: new Date().toISOString() });
    expect(isMarkedDue(recent)).toBe(false);
    expect(isMarkedDue(row({ chain_id: '8', fetched_at: null }))).toBe(false);
  });

  it('searches by name or category, case-insensitively, together with a filter', () => {
    expect(ids(filterSources(rows, 'all', 'TACO'))).toEqual(['1']);
    expect(ids(filterSources(rows, 'all', 'coffee'))).toEqual(['2']);
    expect(ids(filterSources(rows, 'attention', 'wing'))).toEqual(['3']);
    expect(ids(filterSources(rows, 'ok', 'wing'))).toEqual([]);
    expect(ids(filterSources(rows, 'all', '  '))).toHaveLength(6);
    expect(ids(filterSources(rows, 'due', 'jink'))).toEqual(['6']);
    expect(ids(filterSources(rows, 'due', 'taco'))).toEqual([]);
  });

  it('counts each group', () => {
    expect(summarizeSources(rows)).toEqual({ total: 6, ok: 3, attention: 2, manual: 1, notStarted: 1, due: 1, needsStore: 0 });
    expect(summarizeSources([])).toEqual({ total: 0, ok: 0, attention: 0, manual: 0, notStarted: 0, due: 0, needsStore: 0 });
  });
});

describe('needsStore / validatePlaceIdInput', () => {
  const blocked = row({ chain_id: 'b', has_store: false, menu_link_manual: false, built_in_menu_url: null });

  it('flags only chains with no store, no hand-set link and no built-in page', () => {
    expect(needsStore(blocked)).toBe(true);
    expect(needsStore({ ...blocked, has_store: true })).toBe(false);
    expect(needsStore({ ...blocked, menu_link_manual: true })).toBe(false);
    expect(needsStore({ ...blocked, built_in_menu_url: 'https://x.com/menu' })).toBe(false);
  });

  it('does not flag a chain when the server did not say (migration 096 not applied yet)', () => {
    expect(needsStore(row({ chain_id: 'c' }))).toBe(false);
  });

  it('the "store" filter and count use it', () => {
    const rows = [blocked, row({ chain_id: 'ok', has_store: true })];
    expect(filterSources(rows, 'store', '').map((r) => r.chain_id)).toEqual(['b']);
    expect(summarizeSources(rows).needsStore).toBe(1);
  });

  it('accepts a normal place ID and a blank (which removes the store)', () => {
    expect(validatePlaceIdInput('ChIJN1t_tDeuEmsRUsoyG83frY4')).toBeNull();
    expect(validatePlaceIdInput('  ')).toBeNull();
  });

  it('rejects anything that cannot be a place ID', () => {
    expect(validatePlaceIdInput('short')).toMatch(/place ID/);
    expect(validatePlaceIdInput('has spaces in it here')).toMatch(/place ID/);
    expect(validatePlaceIdInput('a'.repeat(201))).toMatch(/place ID/);
    expect(validatePlaceIdInput('https://maps.google.com/?cid=1234567890')).toMatch(/place ID/);
  });
});

describe('parseSearchMiles', () => {
  it('uses 10 miles when the box is blank or not a number', () => {
    expect(parseSearchMiles('')).toBe(10);
    expect(parseSearchMiles('  ')).toBe(10);
    expect(parseSearchMiles('abc')).toBe(10);
    expect(parseSearchMiles('0')).toBe(10);
    expect(parseSearchMiles('-5')).toBe(10);
  });

  it('keeps a sensible distance as a whole number between 1 and 30', () => {
    expect(parseSearchMiles('25')).toBe(25);
    expect(parseSearchMiles(' 7 ')).toBe(7);
    expect(parseSearchMiles('2.6')).toBe(3);
    expect(parseSearchMiles('0.4')).toBe(1);
    expect(parseSearchMiles('99')).toBe(30);
  });
});

describe('describeCheckState', () => {
  const now = new Date('2026-10-04T12:00:00Z');

  it('is "never" when there has been no lookup', () => {
    expect(describeCheckState(null, now)).toEqual({ text: 'never looked up', tone: 'never' });
    expect(describeCheckState('garbage', now)).toEqual({ text: 'never looked up', tone: 'never' });
  });

  it('is "due" when the chain was marked for a fresh lookup', () => {
    expect(describeCheckState('2025-08-30T12:00:00Z', now)).toEqual({ text: 'due for a new lookup', tone: 'due' });
  });

  it('is "fresh", with how long ago, after a recent lookup', () => {
    expect(describeCheckState('2026-10-03T08:00:00Z', now)).toEqual({ text: 'checked 1 day ago', tone: 'fresh' });
    expect(describeCheckState('2026-10-04T08:00:00Z', now)).toEqual({ text: 'checked today', tone: 'fresh' });
  });
});

describe('formatChecked', () => {
  const now = new Date('2026-10-04T12:00:00Z');

  it('handles never, today and days', () => {
    expect(formatChecked(null, now)).toBe('never');
    expect(formatChecked('garbage', now)).toBe('never');
    expect(formatChecked('2026-10-04T08:00:00Z', now)).toBe('today');
    expect(formatChecked('2026-10-03T08:00:00Z', now)).toBe('1 day ago');
    expect(formatChecked('2026-09-24T12:00:00Z', now)).toBe('10 days ago');
  });

  it('shows a backdated "check again" marker as due, not as a strange old date', () => {
    expect(formatChecked('2025-08-30T12:00:00Z', now)).toBe('due for a new lookup');
  });
});

describe('parseSourceFilter', () => {
  it('reads a filter named in the page address, and falls back to all', () => {
    expect(parseSourceFilter('attention')).toBe('attention');
    expect(parseSourceFilter(['due', 'ok'])).toBe('due');
    for (const bad of [undefined, '', 'nonsense', 'ATTENTION', 5, null]) expect(parseSourceFilter(bad)).toBe('all');
  });
});

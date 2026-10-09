import { DEFAULT_CUSTOMER_CONFIG, isVersionBelow, parseCustomerConfig } from './customerConfig';

describe('parseCustomerConfig', () => {
  it('reads the three settings', () => {
    expect(parseCustomerConfig({ maxRadiusMiles: '10', showUnconfirmedMenuItems: 'true', minAppVersion: '1.2.0' }))
      .toEqual({ maxRadiusMiles: 10, showUnconfirmedMenuItems: true, minAppVersion: '1.2.0', announcements: [], categories: [] });
  });

  it('falls back to safe defaults for missing or bad values', () => {
    for (const raw of [null, undefined, {}, 'nope', 5, []]) {
      expect(parseCustomerConfig(raw)).toEqual(DEFAULT_CUSTOMER_CONFIG);
    }
    expect(parseCustomerConfig({ maxRadiusMiles: 'abc', minAppVersion: 'latest' })).toEqual(DEFAULT_CUSTOMER_CONFIG);
    expect(parseCustomerConfig({ maxRadiusMiles: '0' }).maxRadiusMiles).toBe(6);
    expect(parseCustomerConfig({ maxRadiusMiles: '-3' }).maxRadiusMiles).toBe(6);
    expect(parseCustomerConfig({ maxRadiusMiles: '' }).maxRadiusMiles).toBe(6);
  });

  it('only turns unconfirmed items on for the exact text true', () => {
    expect(parseCustomerConfig({ showUnconfirmedMenuItems: 'false' }).showUnconfirmedMenuItems).toBe(false);
    expect(parseCustomerConfig({ showUnconfirmedMenuItems: 'TRUE' }).showUnconfirmedMenuItems).toBe(false);
    expect(parseCustomerConfig({ showUnconfirmedMenuItems: 'true' }).showUnconfirmedMenuItems).toBe(true);
  });
});

describe('parseCustomerConfig announcements', () => {
  it('reads the live announcements the server sends along', () => {
    const cfg = parseCustomerConfig({
      minAppVersion: '0.0.0',
      announcements: [{ id: 'a1', title: 'Hello', message: 'New feature', kind: 'important', link_label: null, link_url: null }],
    });
    expect(cfg.announcements).toEqual([
      { id: 'a1', title: 'Hello', message: 'New feature', kind: 'important', linkLabel: null, linkUrl: null },
    ]);
  });

  it('ignores a missing or malformed announcements field', () => {
    expect(parseCustomerConfig({}).announcements).toEqual([]);
    expect(parseCustomerConfig({ announcements: 'x' }).announcements).toEqual([]);
    expect(parseCustomerConfig({ announcements: [null, 5] }).announcements).toEqual([]);
  });
});

describe('parseCustomerConfig categories', () => {
  it('reads the categories the server sends along', () => {
    const cfg = parseCustomerConfig({
      categories: [
        { key: 'cafe', grp: 'venue', label: 'Cafe or coffee', sort_order: 20 },
        { key: 'x', grp: 'nope', label: 'Bad' },
      ],
    });
    expect(cfg.categories).toEqual([{ key: 'cafe', grp: 'venue', label: 'Cafe or coffee', sort_order: 20 }]);
  });

  it('has none when the field is missing or malformed', () => {
    expect(parseCustomerConfig({}).categories).toEqual([]);
    expect(parseCustomerConfig({ categories: 'x' }).categories).toEqual([]);
  });
});

describe('isVersionBelow', () => {
  it('compares major, minor and patch numerically', () => {
    expect(isVersionBelow('1.0.0', '1.0.1')).toBe(true);
    expect(isVersionBelow('1.9.0', '1.10.0')).toBe(true);
    expect(isVersionBelow('1.2.3', '2.0.0')).toBe(true);
    expect(isVersionBelow('1.0.1', '1.0.0')).toBe(false);
    expect(isVersionBelow('2.0.0', '1.99.99')).toBe(false);
  });

  it('is not below an equal version, or the default minimum', () => {
    expect(isVersionBelow('1.2.0', '1.2.0')).toBe(false);
    expect(isVersionBelow('1.0.0', '0.0.0')).toBe(false);
  });

  it('treats short versions as having zero for the missing parts', () => {
    expect(isVersionBelow('1.2', '1.2.1')).toBe(true);
    expect(isVersionBelow('1.2.1', '1.2')).toBe(false);
    expect(isVersionBelow('2', '1.9.9')).toBe(false);
  });

  it('never locks anyone out when a version cannot be read', () => {
    expect(isVersionBelow(undefined, '1.0.0')).toBe(false);
    expect(isVersionBelow('1.0.0', undefined)).toBe(false);
    expect(isVersionBelow('', '1.0.0')).toBe(false);
    expect(isVersionBelow('dev', '1.0.0')).toBe(false);
    expect(isVersionBelow('1.0.0', 'latest')).toBe(false);
  });
});

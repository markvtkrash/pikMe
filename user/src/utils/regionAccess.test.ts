import { comingSoonCopy, formatOpenDate, isBlocked, isValidEmail, parseRegionAccess, REGION_OPEN } from './regionAccess';

describe('parseRegionAccess', () => {
  it('reads a closed state', () => {
    expect(parseRegionAccess({ enforced: true, allowed: false, status: 'off', stateCode: 'TX', name: 'Texas', goLiveAt: null, countryCode: 'US' }))
      .toEqual({ enforced: true, allowed: false, status: 'off', stateCode: 'TX', name: 'Texas', goLiveAt: null, countryCode: 'US' });
  });
  it('lets the customer in for anything unexpected', () => {
    expect(parseRegionAccess(null)).toEqual(REGION_OPEN);
    expect(parseRegionAccess('x')).toEqual(REGION_OPEN);
    expect(parseRegionAccess({})).toMatchObject({ allowed: true, enforced: false });
    expect(parseRegionAccess({ enforced: true, error: true, allowed: false })).toMatchObject({ allowed: true });
    expect(parseRegionAccess({ enforced: true, allowed: 'no' })).toMatchObject({ allowed: true });
  });
  it('keeps an open answer open', () => {
    expect(parseRegionAccess({ enforced: true, allowed: true, status: 'live', stateCode: 'KS' })).toMatchObject({ enforced: true, allowed: true, status: 'live' });
  });
});

describe('isBlocked', () => {
  it('blocks only when the gate is on and the state is not open', () => {
    expect(isBlocked({ ...REGION_OPEN, enforced: true, allowed: false })).toBe(true);
    expect(isBlocked({ ...REGION_OPEN, enforced: false, allowed: false })).toBe(false);
    expect(isBlocked({ ...REGION_OPEN, enforced: true, allowed: true })).toBe(false);
    expect(isBlocked(null)).toBe(false);
    expect(isBlocked(undefined)).toBe(false);
  });
});

describe('comingSoonCopy', () => {
  const base = { ...REGION_OPEN, enforced: true, allowed: false };
  it('names the state, and the date when one is set', () => {
    const c = comingSoonCopy({ ...base, status: 'off', name: 'Texas', stateCode: 'TX' });
    expect(c.title).toBe('We are not in Texas yet');
    expect(c.body).toMatch(/state by state/);
    expect(c.waitlistPlace).toBe('TX');
    const d = comingSoonCopy({ ...base, status: 'scheduled', name: 'Texas', stateCode: 'TX', goLiveAt: '2030-03-05T12:00:00Z' });
    expect(d.body).toMatch(/We open in Texas on /);
  });
  it('says so outside the US', () => {
    const c = comingSoonCopy({ ...base, status: 'not_us', countryCode: 'CA' });
    expect(c.title).toBe('Coming soon to your area');
    expect(c.body).toMatch(/United States/);
    expect(c.waitlistPlace).toBe('CA');
  });
  it('copes with a state we have no name for', () => {
    expect(comingSoonCopy({ ...base, status: 'unknown', name: null }).title).toBe('We are not in your state yet');
  });
});

describe('dates and emails', () => {
  it('formats a date, or nothing', () => {
    expect(formatOpenDate('2030-03-05T12:00:00Z')).toMatch(/2030/);
    expect(formatOpenDate(null)).toBeNull();
    expect(formatOpenDate('nonsense')).toBeNull();
  });
  it('checks an email', () => {
    expect(isValidEmail('me@example.com')).toBe(true);
    expect(isValidEmail('  me@example.com ')).toBe(true);
    for (const bad of ['', 'me', 'me@', 'me@example', 'me @example.com', '@example.com']) expect(isValidEmail(bad)).toBe(false);
  });
});

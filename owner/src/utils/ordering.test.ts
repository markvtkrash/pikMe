import {
  canTurnOn, centsToInput, clampPrep, countOrderable, deviceTimezone, isOrderable, orderingRequirements, parsePriceToCents, timezoneLabel,
  PricedItem, ReadinessInput,
} from './ordering';

describe('parsePriceToCents', () => {
  it.each([
    ['12', 1200], ['12.5', 1250], ['12.50', 1250], ['$12.50', 1250], [' 12.50 ', 1250], ['1,250', 125000], ['0.99', 99], ['.5', null],
    ['10000', 1000000], ['10000.00', 1000000], ['0.01', 1],
  ] as [string, number | null][])('%j', (text, cents) => {
    const result = parsePriceToCents(text);
    if (cents === null) expect(result.ok).toBe(false);
    else expect(result).toEqual({ ok: true, cents });
  });

  it('takes a blank box to mean "no price"', () => {
    expect(parsePriceToCents('')).toEqual({ ok: true, cents: null });
    expect(parsePriceToCents('   ')).toEqual({ ok: true, cents: null });
    expect(parsePriceToCents('$')).toEqual({ ok: true, cents: null });
  });

  it.each([['abc'], ['12.345'], ['1.2.3'], ['-5'], ['12,50,0x'], ['1e3'], ['12 dollars']])('refuses %j', (text) => {
    expect(parsePriceToCents(text).ok).toBe(false);
  });

  it('refuses zero and more than $10,000', () => {
    expect(parsePriceToCents('0')).toEqual({ ok: false, error: 'The price must be more than $0.00' });
    expect(parsePriceToCents('0.00').ok).toBe(false);
    expect(parsePriceToCents('10000.01')).toEqual({ ok: false, error: 'The price can be at most $10,000.00' });
    expect(parsePriceToCents('99999').ok).toBe(false);
  });

  it('does not lose a cent to floating point', () => {
    expect(parsePriceToCents('19.99')).toEqual({ ok: true, cents: 1999 });
    expect(parsePriceToCents('0.29')).toEqual({ ok: true, cents: 29 });
    expect(parsePriceToCents('1.15')).toEqual({ ok: true, cents: 115 });
  });
});

describe('centsToInput', () => {
  it.each([[1250, '12.50'], [5, '0.05'], [100, '1.00'], [1000000, '10000.00'], [0, '0.00']])('%i is %j', (cents, text) => {
    expect(centsToInput(cents)).toBe(text);
  });
  it('is blank for no price, and round-trips with the parser', () => {
    expect(centsToInput(null)).toBe('');
    expect(centsToInput(undefined)).toBe('');
    for (const cents of [1, 99, 100, 1999, 125000]) {
      expect(parsePriceToCents(centsToInput(cents))).toEqual({ ok: true, cents });
    }
  });
});

const item = (over: Partial<PricedItem> = {}): PricedItem => ({
  item_id: 'i', name: 'Dish', is_verified: true, is_out_of_stock: false, price_cents: 1000, ...over,
});

describe('isOrderable / countOrderable', () => {
  it('needs a confirmed, in-stock dish with a price', () => {
    expect(isOrderable(item())).toBe(true);
    expect(isOrderable(item({ is_verified: false }))).toBe(false);
    expect(isOrderable(item({ is_out_of_stock: true }))).toBe(false);
    expect(isOrderable(item({ price_cents: null }))).toBe(false);
    expect(isOrderable(item({ price_cents: undefined }))).toBe(false);
  });
  it('treats a missing sold-out flag as in stock', () => {
    expect(isOrderable(item({ is_out_of_stock: undefined }))).toBe(true);
    expect(isOrderable(item({ is_out_of_stock: null }))).toBe(true);
  });
  it('counts only the orderable ones', () => {
    expect(countOrderable([item(), item({ is_verified: false }), item({ price_cents: null }), item()])).toBe(2);
    expect(countOrderable([])).toBe(0);
  });
});

describe('orderingRequirements / canTurnOn', () => {
  const ready = { status: 'approved', timezone: 'America/Chicago', items: [item()], isFranchise: false };

  it('lists every requirement, all met when the restaurant is ready', () => {
    const reqs = orderingRequirements(ready);
    expect(reqs.map((r) => r.key).sort()).toEqual(['approved', 'dish', 'independent', 'timezone']);
    expect(reqs.every((r) => r.met)).toBe(true);
    expect(canTurnOn(ready)).toBe(true);
  });

  it.each([
    ['not approved', { status: 'pending' }, 'approved'],
    ['no timezone', { timezone: null }, 'timezone'],
    ['a blank timezone', { timezone: '' }, 'timezone'],
    ['no priced dish', { items: [item({ price_cents: null })] }, 'dish'],
    ['no dishes', { items: [] }, 'dish'],
    ['a franchise', { isFranchise: true }, 'independent'],
  ] as [string, Partial<ReadinessInput>, string][])('is not ready with %s, and says which', (_name, override, key) => {
    const input = { ...ready, ...override };
    expect(canTurnOn(input)).toBe(false);
    expect(orderingRequirements(input).filter((r) => !r.met).map((r) => r.key)).toEqual([key]);
  });
});

describe('the Stripe requirement', () => {
  const ready = { status: 'approved', timezone: 'America/Chicago', items: [item()], isFranchise: false };

  it('is not asked about unless the admin setting makes it required', () => {
    expect(orderingRequirements(ready).map((r) => r.key)).not.toContain('payments');
    expect(orderingRequirements({ ...ready, payments: { required: false, ready: false } }).map((r) => r.key)).not.toContain('payments');
    expect(canTurnOn({ ...ready, payments: { required: false, ready: false } })).toBe(true);
  });

  it('is one more thing to meet once required', () => {
    const missing = { ...ready, payments: { required: true, ready: false } };
    expect(orderingRequirements(missing).filter((r) => !r.met).map((r) => r.key)).toEqual(['payments']);
    expect(canTurnOn(missing)).toBe(false);
    expect(canTurnOn({ ...ready, payments: { required: true, ready: true } })).toBe(true);
  });
});

describe('timezones', () => {
  it('names a known zone by its common name', () => {
    expect(timezoneLabel('America/Chicago')).toBe('Central (America/Chicago)');
    expect(timezoneLabel('Europe/Paris')).toBe('Europe/Paris');
    expect(timezoneLabel(null)).toBe('Not set');
  });
  it('reads this device\'s zone as a name with a slash, or gives none', () => {
    const zone = deviceTimezone();
    expect(zone === null || zone.includes('/')).toBe(true);
  });
});

describe('clampPrep', () => {
  it.each([[0, 5], [4, 5], [5, 5], [20, 20], [240, 240], [500, 240], [22.4, 22]])('%i becomes %i', (input, out) => {
    expect(clampPrep(input)).toBe(out);
  });
});

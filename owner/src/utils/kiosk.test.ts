import {
  BUTTONS_BY_STATUS, buildKioskUrl, confirmFor, clockSkewMs, describeLinkEnd, expiryFor, formatCents, groupOrders, hasEnded, isEndedError,
  isValidKioskToken, newOrderIds, pickupLabel, KioskOrder,
} from './kiosk';

const TOKEN = 'k_' + 'a1b2c3d4'.repeat(8);
const NOW = Date.parse('2026-10-26T18:00:00Z');
const minutes = (n: number) => new Date(NOW + n * 60000).toISOString();

function order(id: string, status: KioskOrder['status'], over: Partial<KioskOrder> = {}): KioskOrder {
  return {
    id, status, pickup_at: minutes(20), created_at: minutes(-1), customer_name: 'Ann', customer_note: null,
    total_cents: 1000, items: [], ...over,
  };
}

describe('confirmFor', () => {
  it('asks a question for every button, using the name of the customer', () => {
    for (const action of ['accept', 'ready', 'completed', 'reject'] as const) {
      const c = confirmFor(action, 'Ann');
      expect(c.title.endsWith('?')).toBe(true);
      expect(c.message).toContain('Ann');
      expect(c.confirmText.length).toBeGreaterThan(0);
    }
  });

  it('has a question for every button the screen can show', () => {
    for (const buttons of Object.values(BUTTONS_BY_STATUS)) {
      for (const b of buttons) expect(confirmFor(b.action, null).title).toBeTruthy();
    }
  });

  it('stresses only the reject, which refunds the customer', () => {
    expect(confirmFor('reject', 'Ann').destructive).toBe(true);
    expect(confirmFor('reject', 'Ann').message).toContain('refunded');
    for (const action of ['accept', 'ready', 'completed'] as const) expect(confirmFor(action, 'Ann').destructive).toBe(false);
  });

  it('says "The customer" when there is no name', () => {
    expect(confirmFor('accept', null).message).toContain('The customer');
    expect(confirmFor('accept', '   ').message).toContain('The customer');
  });
});

describe('isValidKioskToken', () => {
  it('accepts the server\'s shape', () => {
    expect(isValidKioskToken(TOKEN)).toBe(true);
  });
  it.each([
    [undefined], [null], [''], ['garbage'], ['k_abc'], ['K_' + 'a'.repeat(64)], ['k_' + 'g'.repeat(64)], ['k_' + 'a'.repeat(65)], [42],
  ])('rejects %j', (value) => {
    expect(isValidKioskToken(value)).toBe(false);
  });
});

describe('buildKioskUrl', () => {
  it('puts the token on the /kiosk path, with no doubled slash', () => {
    expect(buildKioskUrl('https://owner.example.com', TOKEN)).toBe(`https://owner.example.com/kiosk/${TOKEN}`);
    expect(buildKioskUrl('https://owner.example.com/', TOKEN)).toBe(`https://owner.example.com/kiosk/${TOKEN}`);
    expect(buildKioskUrl('https://owner.example.com///', TOKEN)).toBe(`https://owner.example.com/kiosk/${TOKEN}`);
  });
});

describe('formatCents', () => {
  it.each([[0, '$0.00'], [5, '$0.05'], [100, '$1.00'], [1250, '$12.50'], [1000000, '$10000.00'], [-250, '-$2.50']])('%i is %s', (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });
  it('treats a non-number as zero', () => {
    expect(formatCents(NaN)).toBe('$0.00');
  });
});

describe('pickupLabel', () => {
  it('says how soon a pickup is', () => {
    expect(pickupLabel(minutes(12), NOW)).toMatchObject({ relative: 'in 12 min', late: false });
    expect(pickupLabel(minutes(60), NOW).relative).toBe('in 1 h');
    expect(pickupLabel(minutes(95), NOW).relative).toBe('in 1 h 35 min');
  });
  it('says "now" within a minute either side, and never calls that late', () => {
    for (const m of [-1, 0, 1]) expect(pickupLabel(minutes(m), NOW)).toMatchObject({ relative: 'now', late: false });
  });
  it('says how late a pickup is', () => {
    expect(pickupLabel(minutes(-5), NOW)).toMatchObject({ relative: '5 min late', late: true });
  });
  it('gives a clock time, and copes with a bad date', () => {
    expect(pickupLabel(minutes(12), NOW).clock).toMatch(/\d{1,2}:\d{2}/);
    expect(pickupLabel('not a date', NOW)).toEqual({ clock: '', relative: '', late: false });
  });
});

describe('groupOrders', () => {
  it('splits the orders by status, keeping their order', () => {
    const groups = groupOrders([order('a', 'ready'), order('b', 'placed'), order('c', 'placed'), order('d', 'accepted')]);
    expect(groups.placed.map((o) => o.id)).toEqual(['b', 'c']);
    expect(groups.accepted.map((o) => o.id)).toEqual(['d']);
    expect(groups.ready.map((o) => o.id)).toEqual(['a']);
  });
  it('ignores a status it does not know', () => {
    expect(groupOrders([order('x', 'shipped' as any)])).toEqual({ placed: [], accepted: [], ready: [] });
  });
});

describe('newOrderIds', () => {
  it('announces nothing on the first look', () => {
    expect(newOrderIds(null, [order('a', 'placed')])).toEqual([]);
  });
  it('announces placed orders not seen before', () => {
    expect(newOrderIds(new Set(['a']), [order('a', 'placed'), order('b', 'placed')])).toEqual(['b']);
  });
  it('does not announce an order that is already being made, or one seen before', () => {
    expect(newOrderIds(new Set(['a']), [order('a', 'placed'), order('c', 'accepted')])).toEqual([]);
  });
});

describe('isEndedError', () => {
  it('recognises the server\'s message for a bad or ended link', () => {
    expect(isEndedError('This link has expired or is not valid')).toBe(true);
  });
  it('does not mistake a network problem for it', () => {
    expect(isEndedError('Failed to fetch')).toBe(false);
    expect(isEndedError(undefined)).toBe(false);
    expect(isEndedError(null)).toBe(false);
  });
});

describe('the link\'s end, by the server\'s clock', () => {
  it('measures how far the tablet\'s clock is from the server\'s', () => {
    expect(clockSkewMs(minutes(3), NOW)).toBe(3 * 60000);
    expect(clockSkewMs('nonsense', NOW)).toBe(0);
  });
  it('has ended once the end time has passed on the server\'s clock', () => {
    expect(hasEnded(minutes(10), NOW, 0)).toBe(false);
    expect(hasEnded(minutes(0), NOW, 0)).toBe(true);
    expect(hasEnded(minutes(-1), NOW, 0)).toBe(true);
    // a tablet running 15 minutes slow: by the server's clock the link has already ended
    expect(hasEnded(minutes(10), NOW, 15 * 60000)).toBe(true);
    expect(hasEnded('nonsense', NOW, 0)).toBe(false);
  });
});

describe('the buttons for each status', () => {
  it('a new order can be accepted or rejected, and rejecting is the red one', () => {
    expect(BUTTONS_BY_STATUS.placed.map((b) => b.action)).toEqual(['accept', 'reject']);
    expect(BUTTONS_BY_STATUS.placed.find((b) => b.action === 'reject')?.tone).toBe('danger');
  });
  it('an accepted order is made ready, a ready one is picked up, and neither can be rejected', () => {
    expect(BUTTONS_BY_STATUS.accepted.map((b) => b.action)).toEqual(['ready']);
    expect(BUTTONS_BY_STATUS.ready.map((b) => b.action)).toEqual(['completed']);
  });
});

describe('expiryFor', () => {
  it('"tonight" leaves the time to the server (local midnight)', () => {
    expect(expiryFor('tonight', NOW)).toBeNull();
  });
  it('the longer choices end that many days from now', () => {
    expect(expiryFor('week', NOW)).toBe(new Date(NOW + 7 * 86400000).toISOString());
    expect(expiryFor('month', NOW)).toBe(new Date(NOW + 30 * 86400000).toISOString());
  });
  it('the longest choice stays inside the server\'s 31 day limit', () => {
    expect(Date.parse(expiryFor('month', NOW)!) - NOW).toBeLessThan(31 * 86400000);
  });
});

describe('describeLinkEnd', () => {
  it('says whether the link ends or has ended', () => {
    expect(describeLinkEnd(minutes(60), NOW)).toMatch(/^Ends /);
    expect(describeLinkEnd(minutes(-60), NOW)).toMatch(/^Ended /);
    expect(describeLinkEnd('nonsense', NOW)).toBe('');
  });
});

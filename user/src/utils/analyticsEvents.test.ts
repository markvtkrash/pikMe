import * as fs from 'fs';
import * as path from 'path';
import {
  cleanProps, createDeduper, EVENT_NAMES, isEventName, isValidInstallId, newInstallId, ONCE_PER_LAUNCH, shouldSend,
} from './analyticsEvents';

describe('event names', () => {
  it('knows its own names and nothing else', () => {
    for (const n of EVENT_NAMES) expect(isEventName(n)).toBe(true);
    expect(isEventName('purchase')).toBe(false);
    expect(isEventName('')).toBe(false);
    expect(isEventName(null)).toBe(false);
    expect(isEventName(5)).toBe(false);
  });

  it('is exactly the list the server accepts (migration 147)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/147_app_events.sql'), 'utf8');
    const m = sql.match(/_analytics_events\(\)[\s\S]*?ARRAY\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const server = (m![1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
    expect([...server].sort()).toEqual([...EVENT_NAMES].sort());
  });
});

describe('cleanProps', () => {
  it('keeps short strings, finite numbers and booleans', () => {
    expect(cleanProps({ source: 'explore', count: 3, first: true })).toEqual({ source: 'explore', count: 3, first: true });
  });
  it('drops everything else', () => {
    expect(cleanProps({ a: null, b: undefined, c: { x: 1 }, d: [1], e: NaN, f: Infinity, g: () => 1 })).toEqual({});
  });
  it('drops keys with odd names', () => {
    expect(cleanProps({ 'Has Caps': 1, '1abc': 1, 'a-b': 1, ok_key: 1, [`k${'x'.repeat(30)}`]: 1 })).toEqual({ ok_key: 1 });
  });
  it('cuts a long string to 40 characters', () => {
    expect((cleanProps({ q: 'x'.repeat(100) }).q as string).length).toBe(40);
  });
  it('keeps at most six keys', () => {
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(cleanProps(many))).toHaveLength(6);
  });
  it('copes with anything that is not an object', () => {
    expect(cleanProps(null)).toEqual({});
    expect(cleanProps('x')).toEqual({});
    expect(cleanProps([1, 2])).toEqual({});
    expect(cleanProps(undefined)).toEqual({});
  });
});

describe('install ID', () => {
  it('a new one is valid for the server, and different each time', () => {
    const a = newInstallId();
    const b = newInstallId(Math.random, Date.now() + 1);
    expect(isValidInstallId(a)).toBe(true);
    expect(a).not.toBe(b);
  });
  it('is repeatable with the same random source and time', () => {
    const seq = () => { let i = 0; return () => ((i++ * 7) % 36) / 36; };
    expect(newInstallId(seq(), 1000)).toBe(newInstallId(seq(), 1000));
  });
  it('stays within 8 to 64 characters of letters and digits', () => {
    for (let i = 0; i < 50; i++) {
      const id = newInstallId();
      expect(id.length).toBeGreaterThanOrEqual(8);
      expect(id.length).toBeLessThanOrEqual(64);
      expect(id).toMatch(/^[A-Za-z0-9]+$/);
    }
  });
  it('rejects what the server would', () => {
    expect(isValidInstallId('short')).toBe(false);
    expect(isValidInstallId('has spaces here')).toBe(false);
    expect(isValidInstallId('x'.repeat(65))).toBe(false);
    expect(isValidInstallId(null)).toBe(false);
    expect(isValidInstallId('a-valid_id-123')).toBe(true);
  });
  it('holds nothing personal: it is made only from time and random numbers', () => {
    expect(newInstallId(() => 0.5, 0)).toMatch(/^i0[0-9a-z]+$/);
  });
});

describe('not sending the same thing twice in a launch', () => {
  it('app_open and search go once per launch, whatever the key', () => {
    const d = createDeduper();
    expect(shouldSend(d, 'app_open')).toBe(true);
    expect(shouldSend(d, 'app_open')).toBe(false);
    expect(shouldSend(d, 'search', 'a')).toBe(true);
    expect(shouldSend(d, 'search', 'b')).toBe(false);
  });
  it('a view goes once per restaurant', () => {
    const d = createDeduper();
    expect(shouldSend(d, 'restaurant_view', 'p1')).toBe(true);
    expect(shouldSend(d, 'restaurant_view', 'p1')).toBe(false);
    expect(shouldSend(d, 'restaurant_view', 'p2')).toBe(true);
    expect(shouldSend(d, 'menu_view', 'p1')).toBe(true);
    expect(shouldSend(d, 'menu_view', 'p1')).toBe(false);
  });
  it('different events with the same key do not block each other', () => {
    const d = createDeduper();
    expect(shouldSend(d, 'restaurant_view', 'p1')).toBe(true);
    expect(shouldSend(d, 'menu_view', 'p1')).toBe(true);
    expect(shouldSend(d, 'save', 'p1')).toBe(true);
  });
  it('a new launch starts fresh', () => {
    expect(shouldSend(createDeduper(), 'app_open')).toBe(true);
    expect(shouldSend(createDeduper(), 'app_open')).toBe(true);
  });
  it('only app_open and search are once-per-launch', () => {
    expect([...ONCE_PER_LAUNCH].sort()).toEqual(['app_open', 'search']);
  });
});

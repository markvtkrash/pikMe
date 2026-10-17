import {
  buildFunnel, eventLabel, formatPercent, FUNNEL_STEPS, maxDaily, parseSummary, weekLaterReturn, type AnalyticsSummary,
} from './analytics';

const ev = (event: string, events: number, installs: number) => ({ event, events, installs });

function summaryWith(events: ReturnType<typeof ev>[], extra: Partial<AnalyticsSummary> = {}): AnalyticsSummary {
  return { days: 30, installs: 0, newInstalls: 0, events, daily: [], retention: { cohort: 0, returned: 0 }, ...extra };
}

describe('parseSummary', () => {
  it('reads the server answer', () => {
    const s = parseSummary({
      days: 7, installs: 12, new_installs: 5,
      events: [{ event: 'app_open', events: 30, installs: 12 }],
      daily: [{ day: '2026-10-01', installs: 3 }],
      retention: { cohort: 4, returned: 1 },
    });
    expect(s).toEqual({
      days: 7, installs: 12, newInstalls: 5,
      events: [{ event: 'app_open', events: 30, installs: 12 }],
      daily: [{ day: '2026-10-01', installs: 3 }],
      retention: { cohort: 4, returned: 1 },
    });
  });
  it('copes with nothing, junk and missing parts', () => {
    for (const raw of [null, undefined, 'x', 5, [], {}]) {
      const s = parseSummary(raw);
      expect(s.installs).toBe(0);
      expect(s.events).toEqual([]);
      expect(s.daily).toEqual([]);
      expect(s.retention).toEqual({ cohort: 0, returned: 0 });
      expect(s.days).toBe(30);
    }
  });
  it('turns bad numbers into zero and skips bad rows', () => {
    const s = parseSummary({ installs: 'abc', new_installs: -3, events: [null, { event: 5 }, { event: 'search', events: '7', installs: NaN }], daily: [{ day: 1 }, { day: 'd', installs: '2' }] });
    expect(s.installs).toBe(0);
    expect(s.newInstalls).toBe(0);
    expect(s.events).toEqual([{ event: 'search', events: 7, installs: 0 }]);
    expect(s.daily).toEqual([{ day: 'd', installs: 2 }]);
  });
});

describe('buildFunnel', () => {
  it('lists the steps in order with shares of the first and of the step before', () => {
    const rows = buildFunnel(summaryWith([
      ev('app_open', 100, 100), ev('restaurant_view', 80, 60), ev('menu_view', 50, 30), ev('save', 10, 15), ev('sign_up', 5, 6),
    ]));
    expect(rows.map((r) => r.event)).toEqual([...FUNNEL_STEPS]);
    expect(rows.map((r) => r.installs)).toEqual([100, 60, 30, 15, 6]);
    expect(rows.map((r) => r.ofFirst)).toEqual([100, 60, 30, 15, 6]);
    expect(rows.map((r) => r.ofPrevious)).toEqual([null, 60, 50, 50, 40]);
  });
  it('shows no shares when nobody opened the app, and never divides by zero', () => {
    const rows = buildFunnel(summaryWith([]));
    expect(rows.every((r) => r.installs === 0 && r.ofFirst === null && r.ofPrevious === null)).toBe(true);
  });
  it('a step after an empty one has no share of the previous', () => {
    const rows = buildFunnel(summaryWith([ev('app_open', 10, 10), ev('menu_view', 4, 4)]));
    expect(rows[1].installs).toBe(0);
    expect(rows[1].ofPrevious).toBe(0);
    expect(rows[2].ofPrevious).toBeNull();
  });
  it('never goes past 100% (steps are not forced into order)', () => {
    const rows = buildFunnel(summaryWith([ev('app_open', 5, 5), ev('restaurant_view', 9, 9)]));
    expect(rows[1].ofFirst).toBe(100);
    expect(rows[1].ofPrevious).toBe(100);
  });
  it('rounds to whole percents', () => {
    const rows = buildFunnel(summaryWith([ev('app_open', 3, 3), ev('restaurant_view', 1, 1)]));
    expect(rows[1].ofFirst).toBe(33);
  });
  it('has a label for each step', () => {
    for (const r of buildFunnel(summaryWith([]))) expect(r.label).not.toBe(r.event);
  });
});

describe('weekLaterReturn', () => {
  it('is the share of the old-enough installs that came back', () => {
    expect(weekLaterReturn(summaryWith([], { retention: { cohort: 8, returned: 2 } }))).toBe(25);
  });
  it('is null until some installs are old enough', () => {
    expect(weekLaterReturn(summaryWith([], { retention: { cohort: 0, returned: 0 } }))).toBeNull();
  });
});

describe('small helpers', () => {
  it('formats percents, with a dash for unknown', () => {
    expect(formatPercent(42)).toBe('42%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(null)).toBe('–');
  });
  it('labels events, and shows an unknown name as it is', () => {
    expect(eventLabel('sign_up')).toBe('Signed up');
    expect(eventLabel('something_new')).toBe('something_new');
  });
  it('maxDaily is at least 1 so a bar never divides by zero', () => {
    expect(maxDaily(summaryWith([]))).toBe(1);
    expect(maxDaily(summaryWith([], { daily: [{ day: 'a', installs: 0 }, { day: 'b', installs: 7 }] }))).toBe(7);
  });
});

describe('labels match what the server records (migration 147)', () => {
  it('has a label for every event the server accepts', () => {
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/147_app_events.sql'), 'utf8');
    const m = sql.match(/_analytics_events\(\)[\s\S]*?ARRAY\[([^\]]*)\]/);
    const names = (m[1].match(/'([a-z_]+)'/g) ?? []).map((s: string) => s.replace(/'/g, ''));
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(eventLabel(n)).not.toBe(n);
  });
});

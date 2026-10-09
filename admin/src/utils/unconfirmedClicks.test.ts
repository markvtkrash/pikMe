// Tests for the admin list of restaurants opened with no confirmed menu item (migration 119).
import {
  describeClickCount, describeCrawlState, describeTotal, formatClickDate, toUnconfirmedPage,
} from './unconfirmedClicks';

describe('toUnconfirmedPage', () => {
  it('maps rows and takes the total from the first row', () => {
    const page = toUnconfirmedPage([
      { total_count: '57', place_id: 'p1', restaurant_name: 'Cafe A', address: '1 Main St', city: 'Austin', click_count: 4,
        last_clicked_at: '2026-10-01T10:00:00Z', claimed: true, crawl_state: 'no_items', crawl_detail: 'none' },
      { total_count: '57', place_id: 'p2', restaurant_name: 'Cafe B', click_count: '2', last_clicked_at: '2026-10-02T10:00:00Z' },
    ]);
    expect(page.total).toBe(57);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0]).toMatchObject({ place_id: 'p1', click_count: 4, claimed: true, crawl_state: 'no_items' });
    expect(page.rows[1]).toMatchObject({ click_count: 2, claimed: false, address: null, city: null, crawl_state: null });
  });

  it('is empty and zero for no rows', () => {
    expect(toUnconfirmedPage([])).toEqual({ total: 0, rows: [] });
    expect(toUnconfirmedPage(null)).toEqual({ total: 0, rows: [] });
    expect(toUnconfirmedPage(undefined)).toEqual({ total: 0, rows: [] });
  });
});

describe('describeCrawlState', () => {
  it('marks work already under way as quiet', () => {
    for (const s of ['pending', 'crawling', 'error']) {
      expect(describeCrawlState(s).quiet).toBe(true);
    }
  });

  it('flags the ones that need the admin', () => {
    for (const s of ['no_items', 'needs_attention', 'done', null, undefined, 'something-new']) {
      expect(describeCrawlState(s as any).quiet).toBe(false);
    }
    expect(describeCrawlState('needs_attention').label).toMatch(/could not read/i);
  });

  it('says a restaurant with no crawler record has no menu link yet', () => {
    expect(describeCrawlState(null).label).toMatch(/no menu link yet/i);
    expect(describeCrawlState(undefined).label).toMatch(/add one or upload/i);
  });

  it('no longer knows about link lookups', () => {
    for (const s of ['lookup_waiting', 'lookup_found', 'lookup_none']) {
      expect(describeCrawlState(s).label).toMatch(/no menu link yet/i);
    }
  });
});

describe('wording', () => {
  it('counts clicks', () => {
    expect(describeClickCount(1)).toBe('1 click');
    expect(describeClickCount(3)).toBe('3 clicks');
  });

  it('describes the total', () => {
    expect(describeTotal(0)).toMatch(/^No restaurants/);
    expect(describeTotal(1)).toBe('1 restaurant was opened without a confirmed menu item.');
    expect(describeTotal(12)).toBe('12 restaurants were opened without a confirmed menu item.');
  });

  it('formats a click date and tolerates a bad one', () => {
    expect(formatClickDate('2026-10-01T12:00:00Z')).toMatch(/Oct/);
    expect(formatClickDate('not a date')).toBe('');
  });
});

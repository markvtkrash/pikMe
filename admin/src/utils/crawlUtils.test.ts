// Tests for the pure helpers of the menu-crawl edge function (the browser crawl worker's door into the server).
import {
  clampLimit, clampTaken, crawlStatusFromBuild, parseCrawlResult, MAX_RESULT_NAMES, MAX_WORK_JOBS,
} from '../../../supabase/functions/menu-crawl/crawlUtils';

const PLACE = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
const LINK = 'https://example.com/menu';

describe('clampLimit', () => {
  it('defaults to 3 and never exceeds the most a worker may take', () => {
    expect(clampLimit(undefined)).toBe(3);
    expect(clampLimit('abc')).toBe(3);
    expect(clampLimit(0)).toBe(3);
    expect(clampLimit(-4)).toBe(3);
    expect(clampLimit(2)).toBe(2);
    expect(clampLimit('4')).toBe(4);
    expect(clampLimit(500)).toBe(MAX_WORK_JOBS);
    expect(clampLimit(2.9)).toBe(2);
  });
});

describe('clampTaken', () => {
  it('is how many the run has already taken: a whole number, 0 when missing or invalid', () => {
    expect(clampTaken(undefined)).toBe(0);
    expect(clampTaken('x')).toBe(0);
    expect(clampTaken(-3)).toBe(0);
    expect(clampTaken(null)).toBe(0);
    expect(clampTaken(7)).toBe(7);
    expect(clampTaken('12')).toBe(12);
    expect(clampTaken(2.9)).toBe(2);
    expect(clampTaken(10 ** 9)).toBe(100000);
  });
});

describe('parseCrawlResult', () => {
  const ok = { placeId: PLACE, link: LINK, status: 'ok', names: ['Taco', 'Burrito', 'Nachos'], detail: 'read 3' };

  it('accepts a good result and returns it cleaned', () => {
    const r = parseCrawlResult(ok);
    expect(r).toEqual({ ok: true, value: { placeId: PLACE, link: LINK, status: 'ok', detail: 'read 3', names: ['Taco', 'Burrito', 'Nachos'], text: '' } });
  });

  it('refuses a bad place id, link or status', () => {
    expect(parseCrawlResult({ ...ok, placeId: 'short' })).toEqual({ ok: false, error: 'placeId is not valid' });
    expect(parseCrawlResult({ ...ok, placeId: 42 })).toEqual({ ok: false, error: 'placeId is not valid' });
    expect(parseCrawlResult({ ...ok, link: 'ftp://example.com/x' })).toEqual({ ok: false, error: 'link is not valid' });
    expect(parseCrawlResult({ ...ok, link: 'javascript:alert(1)' })).toEqual({ ok: false, error: 'link is not valid' });
    expect(parseCrawlResult({ ...ok, status: 'done' })).toEqual({ ok: false, error: 'status must be ok, no_items or error' });
    expect(parseCrawlResult(null)).toEqual({ ok: false, error: 'placeId is not valid' });
  });

  it('needs menu text or dish names when the worker says it found dishes', () => {
    expect(parseCrawlResult({ ...ok, names: 'Taco' })).toEqual({ ok: false, error: 'names must be a list' });
    expect(parseCrawlResult({ ...ok, names: undefined })).toEqual({ ok: false, error: 'a result needs menu text or dish names' });
    expect(parseCrawlResult({ ...ok, names: [] })).toEqual({ ok: false, error: 'a result needs menu text or dish names' });
    expect(parseCrawlResult({ ...ok, names: ['x'] })).toEqual({ ok: false, error: 'a result needs menu text or dish names' });
    expect(parseCrawlResult({ ...ok, text: 42 })).toEqual({ ok: false, error: 'text must be a string' });
  });

  it('accepts menu text, with or without the list of names the worker parsed itself', () => {
    const text = '## Mains\n- Taco | 170 Cal\n- Burrito | 300 Cal\n- Nachos | 450 Cal';
    const both = parseCrawlResult({ ...ok, text });
    expect(both.ok && both.value.text).toBe(text);
    expect(both.ok && both.value.names).toEqual(['Taco', 'Burrito', 'Nachos']);
    const textOnly = parseCrawlResult({ placeId: PLACE, link: LINK, status: 'ok', text });
    expect(textOnly.ok && textOnly.value.names).toEqual([]);
    expect(textOnly.ok && textOnly.value.text).toBe(text);
  });

  it('treats very short text as no text, and caps very long text', () => {
    const short = parseCrawlResult({ ...ok, text: 'Taco' });
    expect(short.ok && short.value.text).toBe('');
    const long = parseCrawlResult({ ...ok, text: '- Dish name | 100 Cal\n'.repeat(20000) });
    expect(long.ok && long.value.text.length).toBe(200000);
  });

  it('ignores names for no_items and error results', () => {
    for (const status of ['no_items', 'error']) {
      const r = parseCrawlResult({ placeId: PLACE, link: LINK, status, names: ['Taco'], text: 'Some menu text that is long enough to count', detail: 'x' });
      expect(r.ok && r.value.names).toEqual([]);
      expect(r.ok && r.value.text).toBe('');
    }
  });

  it('cleans the names: strips line breaks, drops too short or too long, drops non-text, and caps the count', () => {
    const r = parseCrawlResult({
      ...ok,
      names: ['  Crunchy\nTaco ', 'x', 'a'.repeat(121), 42, null, { name: 'Obj' }, 'Burrito'],
    });
    expect(r.ok && r.value.names).toEqual(['Crunchy Taco', 'Burrito']);

    const many = Array.from({ length: MAX_RESULT_NAMES + 50 }, (_, i) => `Dish ${i}`);
    const capped = parseCrawlResult({ ...ok, names: many });
    expect(capped.ok && capped.value.names).toHaveLength(MAX_RESULT_NAMES);
  });

  it('shortens the detail to one clean line of at most 300 characters', () => {
    const r = parseCrawlResult({ ...ok, detail: 'line one\nline two ' + 'x'.repeat(400) });
    expect(r.ok && r.value.detail).not.toMatch(/[\r\n]/);
    expect(r.ok && r.value.detail!.length).toBeLessThanOrEqual(300);
    expect(parseCrawlResult({ ...ok, detail: '   ' }).ok && (parseCrawlResult({ ...ok, detail: '   ' }) as any).value.detail).toBeNull();
  });
});

describe('crawlStatusFromBuild', () => {
  it('maps what the place build answered to the crawl status', () => {
    expect(crawlStatusFromBuild('ok')).toBe('ok');
    expect(crawlStatusFromBuild('unreadable')).toBe('no_items');
    expect(crawlStatusFromBuild('no_menu_link')).toBe('no_items');
    expect(crawlStatusFromBuild('is_chain')).toBe('no_items');
    expect(crawlStatusFromBuild('error')).toBe('error');
    expect(crawlStatusFromBuild(undefined)).toBe('error');
    expect(crawlStatusFromBuild('weird')).toBe('error');
  });
});

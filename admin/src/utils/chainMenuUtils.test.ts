// Tests for the pure helpers of the get-chain-menu edge function. Imported
// straight from the functions folder (same approach as passwordRules.test.ts).
import {
  buildMenuPageText, chunk, cleanMenuLink, DEFAULT_MAX_ITEMS, DEFAULT_REFRESH_DAYS, extractJsonNameCandidates,
  fetchedAtForRetry, fetchUrlFor, filterHighlightTitles, htmlToText, matchEstimates, MAX_MENU_ITEMS,
  MAX_REFRESH_DAYS, MIN_MENU_ITEMS, normalizeMaxItems, normalizeRefreshDays, parseJsonArray, sanitizeItemNames,
  buildSourceRecord, isMenuLikeUrl, isRetryableAiError, isUnsupportedFieldError, isValidPlaceId, parseModelParams,
  resolvePlaceId, shouldRunLookup, pickMenuCandidates,
  decideLookupSource, isPdfContentType, isPdfFile, isPdfUrl, isServiceRoleCall, looksLikePdfBytes, PDF_MAX_BYTES, PDF_MAX_PAGES,
  pdfTextToPageText, shouldKeepPreviousMenu, unwrapViewerUrl, mapResultToQueueStatus, parseJobId, stripThinking, toNutrition, withNoThink,
} from '../../../supabase/functions/get-chain-menu/chainMenuUtils';

describe('normalizeRefreshDays', () => {
  it('uses a valid setting', () => {
    expect(normalizeRefreshDays('60')).toBe(60);
    expect(normalizeRefreshDays(45)).toBe(45);
    expect(normalizeRefreshDays(' 7 ')).toBe(7);
  });

  it('falls back to 30 for missing or bad values (0 never means always refresh)', () => {
    for (const bad of [undefined, null, '', 'abc', 0, '0', -5, '-1', NaN, Infinity]) {
      expect(normalizeRefreshDays(bad)).toBe(DEFAULT_REFRESH_DAYS);
    }
  });

  it('caps at 365 and floors fractions', () => {
    expect(normalizeRefreshDays(99999)).toBe(MAX_REFRESH_DAYS);
    expect(normalizeRefreshDays('366')).toBe(MAX_REFRESH_DAYS);
    expect(normalizeRefreshDays(30.9)).toBe(30);
  });

  it('treats a fraction below 1 as invalid', () => {
    expect(normalizeRefreshDays(0.5)).toBe(DEFAULT_REFRESH_DAYS);
  });
});

describe('normalizeMaxItems', () => {
  it('uses a valid setting', () => {
    expect(normalizeMaxItems('60')).toBe(60);
    expect(normalizeMaxItems(30)).toBe(30);
    expect(normalizeMaxItems(' 25 ')).toBe(25);
  });

  it('falls back to 40 for missing or non-numeric values', () => {
    for (const bad of [undefined, null, '', 'abc', NaN, Infinity]) {
      expect(normalizeMaxItems(bad)).toBe(DEFAULT_MAX_ITEMS);
    }
  });

  it('clamps to the minimum usable menu and the hard maximum', () => {
    expect(normalizeMaxItems(0)).toBe(MIN_MENU_ITEMS);
    expect(normalizeMaxItems(-10)).toBe(MIN_MENU_ITEMS);
    expect(normalizeMaxItems(2)).toBe(MIN_MENU_ITEMS);
    expect(normalizeMaxItems(99999)).toBe(MAX_MENU_ITEMS);
  });

  it('floors fractions', () => {
    expect(normalizeMaxItems(40.9)).toBe(40);
  });
});

describe('fetchedAtForRetry', () => {
  const now = new Date('2026-10-04T12:00:00Z');

  it('becomes stale again after the retry window, not the whole refresh period', () => {
    const fetchedAt = fetchedAtForRetry(now, 30, 6);
    const ageMs = now.getTime() - fetchedAt.getTime();
    // Stale (age >= 30 days) is reached 6 hours from now.
    expect(30 * 86_400_000 - ageMs).toBe(6 * 3_600_000);
  });

  it('is never in the future', () => {
    expect(fetchedAtForRetry(now, 1, 100).getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('applies the same fallback for a bad refresh setting', () => {
    expect(fetchedAtForRetry(now, 0, 6).getTime()).toBe(fetchedAtForRetry(now, 30, 6).getTime());
  });
});

describe('cleanMenuLink', () => {
  it('strips tracking and moves the store parameter (Taco Bell sample)', () => {
    const c = cleanMenuLink(
      'https://www.tacobell.com/food?store=034416&utm_source=yext&utm_campaign=googlelistings&utm_medium=referral&utm_term=034416&utm_content=menu&y_source=1_NjE0NjE1NS03MTUtbG9jYXRpb24ubWVudV91cmw%3D',
    );
    expect(c).toEqual({ menuLink: 'https://www.tacobell.com/food', storeRef: 'store=034416', source: 'tacobell.com' });
  });

  it('handles Whataburger unitNum and Slim Chickens olonwp', () => {
    expect(cleanMenuLink('https://whataburger.com/menu?unitNum=1696')).toEqual({
      menuLink: 'https://whataburger.com/menu', storeRef: 'unitNum=1696', source: 'whataburger.com',
    });
    expect(cleanMenuLink('https://order.slimchickens.com/menu/slim-chickens-kansas-overland-park?olonwp=JjBtp_vMLk25gkYh_bnoiQ')).toEqual({
      menuLink: 'https://order.slimchickens.com/menu/slim-chickens-kansas-overland-park', storeRef: '', source: 'order.slimchickens.com',
    });
  });

  it('keeps a link with no query as it is, minus the fragment', () => {
    expect(cleanMenuLink('https://www.cornerbakerycafe.com/menu#top')).toEqual({
      menuLink: 'https://www.cornerbakerycafe.com/menu', storeRef: '', source: 'cornerbakerycafe.com',
    });
  });

  it('keeps non-tracking parameters', () => {
    expect(cleanMenuLink('https://x.com/menu?category=tacos&utm_source=g')?.menuLink).toBe('https://x.com/menu?category=tacos');
  });

  it('rejects empty, non-string and non-http links', () => {
    for (const bad of [undefined, null, '', '   ', 42, 'not a url', 'javascript:alert(1)', 'ftp://x.com/menu', 'file:///etc/passwd']) {
      expect(cleanMenuLink(bad)).toBeNull();
    }
  });
});

describe('fetchUrlFor', () => {
  it('re-adds the store reference', () => {
    expect(fetchUrlFor('https://www.tacobell.com/food', 'store=034416')).toBe('https://www.tacobell.com/food?store=034416');
    expect(fetchUrlFor('https://x.com/menu?a=1', 'store=2')).toBe('https://x.com/menu?a=1&store=2');
    expect(fetchUrlFor('https://x.com/menu', '')).toBe('https://x.com/menu');
  });
});

describe('filterHighlightTitles', () => {
  it('drops generic tags, duplicates and junk, keeps real dishes', () => {
    expect(filterHighlightTitles(['Crunchwrap Supreme', 'Sauce', 'sauce', 'Large Drink', 'Crunchwrap Supreme', '', ' Taquito ', 5, null]))
      .toEqual(['Crunchwrap Supreme', 'Taquito']);
  });

  it('caps the list and ignores non-arrays', () => {
    expect(filterHighlightTitles(Array.from({ length: 100 }, (_, i) => `Dish ${i}`), 10)).toHaveLength(10);
    expect(filterHighlightTitles(undefined)).toEqual([]);
    expect(filterHighlightTitles('Taco')).toEqual([]);
  });

  it('drops absurdly long titles', () => {
    expect(filterHighlightTitles(['x'.repeat(61)])).toEqual([]);
  });
});

describe('sanitizeItemNames', () => {
  it('trims, de-duplicates case-insensitively and removes price/calorie fragments', () => {
    expect(sanitizeItemNames(['  Crunchy Taco ', 'crunchy taco', 'Bean Burrito $3.49', 'Nachos 350 cal', '- Quesadilla -']))
      .toEqual(['Crunchy Taco', 'Bean Burrito', 'Nachos', 'Quesadilla']);
  });

  it('drops site furniture, numbers-only and over/under-length names', () => {
    expect(sanitizeItemNames(['Menu', 'Order Now', 'Sign In', '12345', '$4.99', 'x', 'a'.repeat(81), 'Real Dish']))
      .toEqual(['Real Dish']);
  });

  it('accepts objects with a name and ignores other shapes', () => {
    expect(sanitizeItemNames([{ name: 'Mexican Pizza' }, { nope: 1 }, null, 7, ['x']])).toEqual(['Mexican Pizza']);
  });

  it('caps the list and ignores non-arrays', () => {
    const many = Array.from({ length: 500 }, (_, i) => `Dish number ${i}`);
    expect(sanitizeItemNames(many)).toHaveLength(MAX_MENU_ITEMS);
    expect(sanitizeItemNames(many, 5)).toHaveLength(5);
    expect(sanitizeItemNames('Taco')).toEqual([]);
    expect(sanitizeItemNames(undefined)).toEqual([]);
  });
});

describe('parseJsonArray', () => {
  it('parses a bare array and a fenced one', () => {
    expect(parseJsonArray('["a","b"]')).toEqual(['a', 'b']);
    expect(parseJsonArray('```json\n["a"]\n```')).toEqual(['a']);
  });

  it('finds an array wrapped in prose', () => {
    expect(parseJsonArray('Here you go: ["a","b"] Hope that helps')).toEqual(['a', 'b']);
  });

  it('returns null when there is no usable array', () => {
    expect(parseJsonArray('no menu here')).toBeNull();
    expect(parseJsonArray('{"a":1}')).toBeNull();
    expect(parseJsonArray('[1, 2')).toBeNull();
    expect(parseJsonArray('')).toBeNull();
    expect(parseJsonArray(undefined as unknown as string)).toBeNull();
  });

  it('returns an empty array for "[]"', () => {
    expect(parseJsonArray('[]')).toEqual([]);
  });
});

describe('htmlToText', () => {
  it('drops scripts/styles/comments and keeps one block per line', () => {
    const html = '<style>.a{}</style><div>Crunchy Taco</div><script>var x=1</script><li>Bean Burrito</li><!-- hidden --><p>A &amp; B</p>';
    expect(htmlToText(html)).toBe('Crunchy Taco\nBean Burrito\nA & B');
  });
});

describe('extractJsonNameCandidates', () => {
  const nextData = (obj: unknown) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(obj)}</script></html>`;

  it('collects name-like strings from __NEXT_DATA__ at any depth', () => {
    const html = nextData({ props: { pageProps: { categories: [{ name: 'Tacos', products: [{ name: 'Crunchy Taco', calories: 170 }, { title: 'Nacho Fries' }] }] } } });
    expect(extractJsonNameCandidates(html).sort()).toEqual(['Crunchy Taco', 'Nacho Fries', 'Tacos']);
  });

  it('reads JSON-LD blocks too', () => {
    const html = '<script type="application/ld+json">{"@type":"Menu","hasMenuItem":[{"name":"Margherita Pizza"},{"name":"Caesar Salad"}]}</script>';
    expect(extractJsonNameCandidates(html).sort()).toEqual(['Caesar Salad', 'Margherita Pizza']);
  });

  it('ignores other scripts, slugs, urls, markup and over-long or letterless values', () => {
    const html =
      '<script>var name="Not Data"</script>' +
      nextData({
        a: { name: 'crunchwrap-supreme' }, b: { name: 'https://x.com/a' }, c: { name: '<b>Bold</b>' },
        d: { name: 'x'.repeat(81) }, e: { name: '12345' }, f: { name: '  Real   Dish  ' }, g: { name: 'Taco' },
      });
    expect(extractJsonNameCandidates(html).sort()).toEqual(['Real Dish', 'Taco']);
  });

  it('de-duplicates and caps the number of names', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `Dish ${i}` }));
    expect(extractJsonNameCandidates(nextData({ items: [...many, ...many] }))).toHaveLength(50);
    expect(extractJsonNameCandidates(nextData({ items: many }), 10)).toHaveLength(10);
  });

  it('survives invalid JSON, empty blocks and plain pages', () => {
    expect(extractJsonNameCandidates('<script id="__NEXT_DATA__">{not json</script>')).toEqual([]);
    expect(extractJsonNameCandidates('<script id="__NEXT_DATA__"></script>')).toEqual([]);
    expect(extractJsonNameCandidates('<div>Just a page</div>')).toEqual([]);
    expect(extractJsonNameCandidates('')).toEqual([]);
  });

  it('does not loop forever on deeply nested data', () => {
    let deep: any = { name: 'Deep Dish' };
    for (let i = 0; i < 100; i++) deep = { child: deep };
    expect(extractJsonNameCandidates(nextData(deep))).toEqual([]);
  });
});

describe('buildMenuPageText', () => {
  it('is just the visible text when the page has no embedded data', () => {
    expect(buildMenuPageText('<div>Crunchy Taco</div>')).toBe('Crunchy Taco');
  });

  it('adds the embedded names, which is what rescues pages whose menu lives in JSON', () => {
    const html = '<nav>Burritos</nav><script id="__NEXT_DATA__">{"p":[{"name":"Crunchwrap Supreme"},{"name":"Mexican Pizza"}]}</script>';
    const text = buildMenuPageText(html);
    expect(text).toContain('Burritos');
    expect(text).toContain('EMBEDDED DATA');
    expect(text).toContain('Crunchwrap Supreme');
    expect(text).toContain('Mexican Pizza');
  });

  it('stays within the limit and keeps the embedded names even when the visible text is huge', () => {
    const html = `<div>${'word '.repeat(10000)}</div><script id="__NEXT_DATA__">{"p":[{"name":"Late Dish"}]}</script>`;
    const text = buildMenuPageText(html, 5000);
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(text).toContain('Late Dish');
  });
});

describe('withNoThink', () => {
  it('appends /no_think for Qwen 3 models, whatever the casing or dashes', () => {
    for (const model of ['qwen3.6-35b', 'Qwen3-32B', 'qwen-3-8b', 'QWEN 3.5']) {
      expect(withNoThink('List items', model)).toBe('List items\n\n/no_think');
    }
  });

  it('leaves other models and empty names alone', () => {
    for (const model of ['deepseek-v4-flash', 'claude-haiku-4-5-20251001', 'qwen2.5-72b', '', undefined as unknown as string]) {
      expect(withNoThink('List items', model)).toBe('List items');
    }
  });

  it('does not add it twice', () => {
    const once = withNoThink('List items', 'qwen3.6-35b');
    expect(withNoThink(once, 'qwen3.6-35b')).toBe(once);
  });
});

describe('buildSourceRecord', () => {
  const cleaned = cleanMenuLink('https://www.tacobell.com/food?store=034416&utm_source=yext')!;
  const website = cleanMenuLink('https://locations.tacobell.com/ks/olathe/x.html?utm_source=g')!;

  it('records everything a full lookup returned', () => {
    expect(buildSourceRecord({ cleaned, website, types: ['Fast food restaurant'], highlights: ['Crunchwrap Supreme'] })).toEqual({
      menu_link: 'https://www.tacobell.com/food',
      store_ref: 'store=034416',
      menu_source: 'tacobell.com',
      website: 'https://locations.tacobell.com/ks/olathe/x.html',
      place_types: ['Fast food restaurant'],
      highlights: ['Crunchwrap Supreme'],
    });
  });

  it('NEVER blanks the stored menu link when SerpApi returned no menu block (the bug that lost a good link)', () => {
    const record = buildSourceRecord({ cleaned: null, website, types: [], highlights: [] });
    expect(record).not.toHaveProperty('menu_link');
    expect(record).not.toHaveProperty('store_ref');
    expect(record).not.toHaveProperty('menu_source');
    expect(record).toEqual({ website: 'https://locations.tacobell.com/ks/olathe/x.html' });
  });

  it('does not blank stored types or highlights when this lookup had none', () => {
    const record = buildSourceRecord({ cleaned, website: null, types: [], highlights: [] });
    expect(record).not.toHaveProperty('place_types');
    expect(record).not.toHaveProperty('highlights');
    expect(record).not.toHaveProperty('website');
  });

  it('stores no store_ref when the link has none', () => {
    const plain = cleanMenuLink('https://order.slimchickens.com/menu/x?olonwp=abc')!;
    expect(buildSourceRecord({ cleaned: plain, website: null, types: [], highlights: [] }).store_ref).toBeNull();
  });

  it('writes nothing at all for an empty lookup', () => {
    expect(buildSourceRecord({ cleaned: null, website: null, types: [], highlights: [] })).toEqual({});
  });
});

describe('pickMenuCandidates', () => {
  const fresh = cleanMenuLink('https://www.tacobell.com/food?store=034416')!;
  const locator = cleanMenuLink('https://locations.tacobell.com/ks/olathe/x.html')!;
  const menuSite = cleanMenuLink('https://www.wingstop.com/location/x/menu')!;

  it('prefers the link SerpApi just returned, with its store parameter', () => {
    expect(pickMenuCandidates({ cleaned: fresh, website: locator, storedLink: 'https://old.example/menu', storedRef: '' }))
      .toEqual(['https://www.tacobell.com/food?store=034416']);
  });

  it('falls back to the stored link (with its store parameter) when SerpApi returned none', () => {
    expect(pickMenuCandidates({ cleaned: null, website: locator, storedLink: 'https://www.tacobell.com/food', storedRef: 'store=034416' }))
      .toEqual(['https://www.tacobell.com/food?store=034416']);
    expect(pickMenuCandidates({ cleaned: null, website: null, storedLink: 'https://x.com/menu', storedRef: null }))
      .toEqual(['https://x.com/menu']);
  });

  it('uses the website only when it looks like a menu page', () => {
    expect(pickMenuCandidates({ cleaned: null, website: menuSite, storedLink: null, storedRef: null }))
      .toEqual(['https://www.wingstop.com/location/x/menu']);
    expect(pickMenuCandidates({ cleaned: null, website: locator, storedLink: null, storedRef: null })).toEqual([]);
  });

  it('returns nothing when there is nothing usable', () => {
    expect(pickMenuCandidates({ cleaned: null, website: null, storedLink: undefined, storedRef: undefined })).toEqual([]);
    expect(pickMenuCandidates({ cleaned: null, website: null, storedLink: '', storedRef: '' })).toEqual([]);
  });
});

describe('shouldKeepPreviousMenu', () => {
  it('keeps the old menu when the new one is less than half its size', () => {
    expect(shouldKeepPreviousMenu(40, 17, 40)).toBe(true);
    expect(shouldKeepPreviousMenu(40, 19, 40)).toBe(true);
    expect(shouldKeepPreviousMenu(40, 0, 40)).toBe(true);
  });

  it('replaces it when the new one is about as large or larger', () => {
    expect(shouldKeepPreviousMenu(40, 20, 40)).toBe(false);
    expect(shouldKeepPreviousMenu(40, 38, 40)).toBe(false);
    expect(shouldKeepPreviousMenu(40, 60, 40)).toBe(false);
  });

  it('allows for the cap being lowered since the last run', () => {
    // Previous 40 items, cap now 10: 6 items is fine (expected 10, half is 5).
    expect(shouldKeepPreviousMenu(40, 6, 10)).toBe(false);
    expect(shouldKeepPreviousMenu(40, 4, 10)).toBe(true);
    // Cap never treated as below the usable minimum (5): half of 5 is 2.5.
    expect(shouldKeepPreviousMenu(40, 3, 1)).toBe(false);
    expect(shouldKeepPreviousMenu(40, 2, 1)).toBe(true);
  });

  it('never blocks a first menu or a tiny previous one', () => {
    expect(shouldKeepPreviousMenu(0, 5, 40)).toBe(false);
    expect(shouldKeepPreviousMenu(4, 0, 40)).toBe(false);
    expect(shouldKeepPreviousMenu(NaN, 5, 40)).toBe(false);
  });
});

describe('isMenuLikeUrl', () => {
  it('accepts menu and ordering pages', () => {
    for (const url of [
      'https://www.wingstop.com/location/wingstop-2326-overland-park-ks-66223/menu',
      'https://www.tacobell.com/food',
      'https://order.teriyakimadness.com/menu/overland-park',
      'https://order.firstwatch.com/',
      'https://www.noodles.com/location/noodles-overland-park/menu',
      'https://x.com/our-menu',
      'https://x.com/menus/',
    ]) expect(isMenuLikeUrl(url)).toBe(true);
  });

  it('rejects locator, home and marketing pages', () => {
    for (const url of [
      'https://locations.tacobell.com/ks/olathe/15109-w--151st-st-.html',
      'https://teriyakimadness.com/locations/ks-overlandpark/',
      'https://www.firstwatch.com/locations/151st-street/',
      'https://www.dunkindonuts.com/locations/us/ks/overland-park/7722-w-151st-st/store-348358/',
      'https://slimchickens.com/',
      'https://x.com/menuette',
    ]) expect(isMenuLikeUrl(url)).toBe(false);
  });

  it('rejects invalid input', () => {
    for (const bad of [undefined, null, '', 'not a url', 42]) expect(isMenuLikeUrl(bad)).toBe(false);
  });
});

describe('isRetryableAiError', () => {
  it('retries timeouts, network problems and provider 5xx/429', () => {
    const timeout = new Error('The signal has timed out.');
    timeout.name = 'TimeoutError';
    expect(isRetryableAiError(timeout)).toBe(true);
    expect(isRetryableAiError(new Error('Signal timed out.'))).toBe(true);
    expect(isRetryableAiError(new Error('connection reset by peer'))).toBe(true);
    expect(isRetryableAiError(new Error('Quicksilver API error 503'))).toBe(true);
    expect(isRetryableAiError(new Error('Claude API returned 429'))).toBe(true);
    expect(isRetryableAiError(new Error('Quicksilver API error 500'))).toBe(true);
  });

  it('does not retry client errors or missing keys', () => {
    expect(isRetryableAiError(new Error('Quicksilver API error 401'))).toBe(false);
    expect(isRetryableAiError(new Error('Quicksilver API error 400'))).toBe(false);
    expect(isRetryableAiError(new Error('QUICKSILVER_API_KEY secret not configured'))).toBe(false);
    expect(isRetryableAiError(null)).toBe(false);
    expect(isRetryableAiError(undefined)).toBe(false);
  });
});

describe('shouldRunLookup', () => {
  const minute = 60 * 1000;
  const base = { force: false, stale: false, status: 'ok', updatedAgeMs: 0 };

  it('runs a normal request only when the stored lookup is stale', () => {
    expect(shouldRunLookup({ ...base, stale: true })).toBe(true);
    expect(shouldRunLookup({ ...base, stale: false })).toBe(false);
  });

  it('retakes a claimed lookup that has been stuck for over 10 minutes, but not a fresh claim', () => {
    expect(shouldRunLookup({ ...base, status: 'pending', stale: false, updatedAgeMs: 11 * minute })).toBe(true);
    expect(shouldRunLookup({ ...base, status: 'pending', stale: false, updatedAgeMs: 2 * minute })).toBe(false);
    expect(shouldRunLookup({ ...base, status: 'pending', stale: false, updatedAgeMs: 10 * minute })).toBe(false);
  });

  it('an admin pull runs even when the chain is fresh', () => {
    expect(shouldRunLookup({ ...base, force: true, stale: false, status: 'ok' })).toBe(true);
    expect(shouldRunLookup({ ...base, force: true, stale: false, status: 'error' })).toBe(true);
  });

  it('an admin pull never runs on top of a lookup that is in flight', () => {
    expect(shouldRunLookup({ ...base, force: true, status: 'pending', stale: false, updatedAgeMs: 30 * 1000 })).toBe(false);
  });

  it('an admin pull DOES run right after the admin saved a manual link (pending but marked due)', () => {
    // Saving a link leaves the row pending with an old fetched_at (stale) and a fresh updated_at.
    expect(shouldRunLookup({ ...base, force: true, status: 'pending', stale: true, updatedAgeMs: 5 * 1000 })).toBe(true);
  });

  it('a stuck claim does not block an admin pull either', () => {
    expect(shouldRunLookup({ ...base, force: true, status: 'pending', stale: false, updatedAgeMs: 20 * minute })).toBe(true);
  });
});

describe('isValidPlaceId / resolvePlaceId', () => {
  const real = 'ChIJUeWR1K6_wIcRldq78iRgCKc';

  it('accepts a real place id and rejects junk', () => {
    expect(isValidPlaceId(real)).toBe(true);
    for (const bad of ['', 'short', 'has space in it xx', 'a'.repeat(201), '../../etc/passwd', undefined, null, 42]) {
      expect(isValidPlaceId(bad)).toBe(false);
    }
  });

  it('prefers the request, then the stored one, then a cached store', () => {
    const other = 'ChIJOtherPlaceId12345';
    expect(resolvePlaceId({ bodyPlaceId: real, storedPlaceId: other, cachedPlaceId: other })).toBe(real);
    expect(resolvePlaceId({ storedPlaceId: other, cachedPlaceId: real })).toBe(other);
    expect(resolvePlaceId({ cachedPlaceId: real })).toBe(real);
  });

  it('skips invalid candidates and returns null when none is usable', () => {
    expect(resolvePlaceId({ bodyPlaceId: 'bad', storedPlaceId: null, cachedPlaceId: real })).toBe(real);
    expect(resolvePlaceId({ bodyPlaceId: 'bad', storedPlaceId: '', cachedPlaceId: undefined })).toBeNull();
    expect(resolvePlaceId({})).toBeNull();
  });
});

describe('isUnsupportedFieldError', () => {
  it('recognises the provider message from the real log, and common variants', () => {
    for (const msg of [
      ': {"error":{"message":"Unsupported request field(s): chat_template_kwargs","type":"invalid_request_error","code":"unsupported_parameter"}}',
      'Unsupported parameter: reasoning_effort',
      'unsupported_parameter',
      'Unknown parameter: enable_thinking',
      'Unrecognized request argument supplied: foo',
      'Extra inputs are not permitted',
    ]) expect(isUnsupportedFieldError(msg)).toBe(true);
  });

  it('does not treat other 400s as an unsupported field', () => {
    for (const msg of [
      ': {"error":{"message":"The model `qwen9` does not exist"}}',
      'max_tokens is too large',
      'Invalid API key',
      '',
    ]) expect(isUnsupportedFieldError(msg)).toBe(false);
    expect(isUnsupportedFieldError(undefined)).toBe(false);
    expect(isUnsupportedFieldError(null)).toBe(false);
  });
});

describe('parseModelParams', () => {
  it('turns a dotted name into a nested object (the Quicksilver reasoning switch)', () => {
    expect(parseModelParams('reasoning.enabled=false')).toEqual({ reasoning: { enabled: false } });
  });

  it('reads several semicolon-separated pairs, with spaces and a trailing semicolon', () => {
    expect(parseModelParams(' reasoning.enabled = false ; temperature=0.2 ;top_p=1; ')).toEqual({
      reasoning: { enabled: false },
      temperature: 0.2,
      top_p: 1,
    });
  });

  it('merges pairs that share a parent', () => {
    expect(parseModelParams('reasoning.enabled=false;reasoning.effort=low')).toEqual({
      reasoning: { enabled: false, effort: 'low' },
    });
  });

  it('converts values: booleans (any case), numbers, null, quoted and plain text', () => {
    expect(parseModelParams(`a=true;b=FALSE;c=42;d=-1.5;e=null;f="quoted text";g='single';h=plain`)).toEqual({
      a: true, b: false, c: 42, d: -1.5, e: null, f: 'quoted text', g: 'single', h: 'plain',
    });
  });

  it('keeps a lone or mismatched quote as text instead of treating it as a wrapper', () => {
    expect(parseModelParams(`a="open;b=it's;c="mixed'`)).toEqual({ a: '"open', b: "it's", c: `"mixed'` });
  });

  it('keeps an equals sign inside a value', () => {
    expect(parseModelParams('note=a=b')).toEqual({ note: 'a=b' });
  });

  it('never lets the setting override the fields the function controls', () => {
    expect(parseModelParams('model=x;messages=y;max_tokens=1;stream=true;n=5;MODEL=z;keep=1')).toEqual({ keep: 1 });
  });

  it('ignores pairs that are malformed', () => {
    for (const bad of ['', '   ', ';;;', 'novalue', '=true', 'a.=1', '.a=1', 'a..b=1', 'bad name=1', '1abc=1', 'a=', 'a.b=']) {
      expect(parseModelParams(bad)).toEqual({});
    }
    expect(parseModelParams('good=1;novalue;also.good=2')).toEqual({ good: 1, also: { good: 2 } });
  });

  it('does not let a later pair overwrite a plain value with an object', () => {
    expect(parseModelParams('a=1;a.b=2')).toEqual({ a: 1 });
  });

  it('is safe against prototype pollution', () => {
    parseModelParams('__proto__.polluted=yes;constructor.prototype.x=1;a.__proto__.y=1');
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).x).toBeUndefined();
    expect(({} as any).y).toBeUndefined();
    expect(parseModelParams('__proto__.polluted=yes')).toEqual({});
  });

  it('returns nothing for non-string input', () => {
    for (const bad of [undefined, null, 5, {}, ['a=1']]) expect(parseModelParams(bad)).toEqual({});
  });
});

describe('stripThinking', () => {
  it('removes inline reasoning blocks', () => {
    expect(stripThinking('<think>maybe [1,2] here</think>["a","b"]')).toBe('["a","b"]');
    expect(stripThinking('<THINK>x</THINK>\n["a"]')).toBe('["a"]');
  });

  it('removes reasoning that is closed but never opened', () => {
    expect(stripThinking('reasoning [x]</think>["a"]')).toBe('["a"]');
  });

  it('leaves a normal answer alone, and survives empty input', () => {
    expect(stripThinking('["a","b"]')).toBe('["a","b"]');
    expect(stripThinking('')).toBe('');
    expect(stripThinking(undefined as unknown as string)).toBe('');
  });

  it('lets the array parser work after stripping reasoning that contains brackets', () => {
    expect(parseJsonArray(stripThinking('<think>options: [x, y]</think>["Taco"]'))).toEqual(['Taco']);
  });
});

describe('chunk', () => {
  it('splits into batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });
});

describe('toNutrition', () => {
  const good = { calories: 350, protein_g: 13, totalCarbs_g: 55, totalFat_g: 9, saturatedFat_g: 3, sodium_mg: 1000, dietaryFiber_g: 13, sugars_g: 3 };

  it('accepts a sane row and rounds calories/sodium', () => {
    expect(toNutrition({ ...good, calories: 350.6, sodium_mg: 999.7 })).toMatchObject({ calories: 351, sodium_mg: 1000, protein_g: 13 });
  });

  it('rejects implausible or missing calories', () => {
    for (const calories of [0, -10, 'abc', undefined, null, 6000]) {
      expect(toNutrition({ ...good, calories })).toBeNull();
    }
    expect(toNutrition(null)).toBeNull();
    expect(toNutrition('x')).toBeNull();
  });

  it('turns bad or negative macros into 0 and clamps huge ones', () => {
    const n = toNutrition({ ...good, protein_g: 'lots', totalFat_g: -4, sodium_mg: 999999 })!;
    expect(n.protein_g).toBe(0);
    expect(n.totalFat_g).toBe(0);
    expect(n.sodium_mg).toBe(20000);
  });
});

describe('matchEstimates', () => {
  const row = (name: string, calories: number) => ({ name, calories, protein_g: 5, totalCarbs_g: 20, totalFat_g: 6, saturatedFat_g: 2, sodium_mg: 300, dietaryFiber_g: 1, sugars_g: 2 });

  it('pairs estimates to the requested names, case-insensitively', () => {
    const out = matchEstimates(['Crunchy Taco', 'Bean Burrito'], [row('bean burrito', 350), row('CRUNCHY TACO', 170)]);
    expect(out.map((o) => o.name)).toEqual(['Crunchy Taco', 'Bean Burrito']);
    expect(out[0].nutrition.calories).toBe(170);
  });

  it('never adds items the model invented', () => {
    const out = matchEstimates(['Crunchy Taco'], [row('Crunchy Taco', 170), row('Secret Item', 500)]);
    expect(out.map((o) => o.name)).toEqual(['Crunchy Taco']);
  });

  it('drops names that got no usable estimate', () => {
    const out = matchEstimates(['A Dish', 'B Dish', 'C Dish'], [row('A Dish', 200), { name: 'B Dish', calories: 0 }]);
    expect(out.map((o) => o.name)).toEqual(['A Dish']);
  });

  it('returns nothing for a failed parse', () => {
    expect(matchEstimates(['A Dish'], null)).toEqual([]);
  });
});

describe('isServiceRoleCall', () => {
  const key = 'service-key-1234567890-abcdef';

  it('accepts exactly the service key as a bearer token', () => {
    expect(isServiceRoleCall(`Bearer ${key}`, key)).toBe(true);
  });

  it('rejects a different key, a missing header and a key without Bearer', () => {
    expect(isServiceRoleCall('Bearer other-key-1234567890-abcdef', key)).toBe(false);
    expect(isServiceRoleCall(null, key)).toBe(false);
    expect(isServiceRoleCall(undefined, key)).toBe(false);
    expect(isServiceRoleCall(key, key)).toBe(false);
  });

  it('never matches when the server has no usable key', () => {
    expect(isServiceRoleCall('Bearer ', '')).toBe(false);
    expect(isServiceRoleCall('Bearer undefined', undefined)).toBe(false);
    expect(isServiceRoleCall('Bearer short', 'short')).toBe(false);
  });
});

describe('decideLookupSource', () => {
  const place = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

  it('reads a hand-set link as is, whatever else is known', () => {
    expect(decideLookupSource({ manualLink: true, placeId: place, builtInPage: 'https://x.com/menu' })).toBe('manual');
    expect(decideLookupSource({ manualLink: true, placeId: null, builtInPage: null })).toBe('manual');
  });

  it('asks Google when a store is known, even if there is a built-in page', () => {
    expect(decideLookupSource({ manualLink: false, placeId: place, builtInPage: 'https://x.com/menu' })).toBe('serpapi');
    expect(decideLookupSource({ manualLink: false, placeId: place, builtInPage: null })).toBe('serpapi');
  });

  it('reads the built-in page directly when there is no store', () => {
    expect(decideLookupSource({ manualLink: false, placeId: null, builtInPage: 'https://x.com/menu' })).toBe('built_in');
  });

  it('has nothing to look up with no store, no link and no built-in page (a blank page does not count)', () => {
    expect(decideLookupSource({ manualLink: false, placeId: null, builtInPage: null })).toBe('none');
    expect(decideLookupSource({ manualLink: false, placeId: null, builtInPage: '   ' })).toBe('none');
  });
});

describe('PDF detection', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it('recognises the server saying it is a PDF', () => {
    expect(isPdfContentType('application/pdf')).toBe(true);
    expect(isPdfContentType('application/PDF; charset=binary')).toBe(true);
    expect(isPdfContentType('application/x-pdf')).toBe(true);
    expect(isPdfContentType('text/html; charset=utf-8')).toBe(false);
    expect(isPdfContentType('application/octet-stream')).toBe(false);
    expect(isPdfContentType(null)).toBe(false);
  });

  it('recognises an address that ends in .pdf, ignoring anything after ? or #', () => {
    expect(isPdfUrl('https://x.com/files/menu.pdf')).toBe(true);
    expect(isPdfUrl('https://x.com/files/Menu.PDF?v=3#page=2')).toBe(true);
    expect(isPdfUrl('https://x.com/menu')).toBe(false);
    expect(isPdfUrl('https://x.com/menu.pdf.html')).toBe(false);
    expect(isPdfUrl('https://x.com/menu?file=a.pdf')).toBe(false);
    expect(isPdfUrl('not a link')).toBe(false);
  });

  it('recognises the file itself by its first bytes, even with a few stray bytes before them', () => {
    expect(looksLikePdfBytes(enc('%PDF-1.7\n...'))).toBe(true);
    expect(looksLikePdfBytes(enc('\n\n  %PDF-1.4 rest'))).toBe(true);
    expect(looksLikePdfBytes(enc('<html><body>menu</body></html>'))).toBe(false);
    expect(looksLikePdfBytes(enc(''))).toBe(false);
    expect(looksLikePdfBytes(enc('%PDF'))).toBe(false);
  });

  it('any one of the three signs is enough (a mislabelled PDF is still found)', () => {
    const pdfBytes = enc('%PDF-1.7 data');
    const htmlBytes = enc('<html></html>');
    expect(isPdfFile({ contentType: 'application/octet-stream', url: 'https://x.com/download?id=7', bytes: pdfBytes })).toBe(true);
    expect(isPdfFile({ contentType: 'application/pdf', url: 'https://x.com/menu', bytes: htmlBytes })).toBe(true);
    expect(isPdfFile({ contentType: 'text/html', url: 'https://x.com/menu.pdf', bytes: htmlBytes })).toBe(true);
    expect(isPdfFile({ contentType: 'text/html', url: 'https://x.com/menu', bytes: htmlBytes })).toBe(false);
  });

  it('has sensible limits', () => {
    expect(PDF_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(PDF_MAX_PAGES).toBeGreaterThanOrEqual(10);
  });
});

describe('pdfTextToPageText', () => {
  it('keeps the line breaks of a menu and collapses stray spacing and blank lines', () => {
    const raw = 'Crunchy   Taco \r\n\r\n\r\n\r\nBean\u00a0Burrito\t\tSupreme\r\n  Nachos  ';
    expect(pdfTextToPageText(raw, 1000)).toBe('Crunchy Taco\n\nBean Burrito Supreme\nNachos');
  });

  it('cuts to the limit and handles empty text', () => {
    expect(pdfTextToPageText('abcdefghij', 4)).toBe('abcd');
    expect(pdfTextToPageText('   \n  ', 100)).toBe('');
    expect(pdfTextToPageText('abc', 0)).toBe('');
  });
});

describe('unwrapViewerUrl', () => {
  const pdf = 'https://raisingcanes.cdn.prismic.io/raisingcanes/Z9s0jTiBA97Girps_Digital-Takeout_Full_8.5x11_No-Price.pdf';

  it('returns the file inside a Google Docs viewer link', () => {
    expect(unwrapViewerUrl(`https://docs.google.com/viewerng/viewer?url=${pdf}`)).toBe(pdf);
    expect(unwrapViewerUrl(`https://docs.google.com/viewer?url=${encodeURIComponent(pdf)}&embedded=true`)).toBe(pdf);
    expect(unwrapViewerUrl(`https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(pdf)}`)).toBe(pdf);
  });

  it('returns the file inside a Microsoft Office viewer link', () => {
    expect(unwrapViewerUrl(`https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(pdf)}`)).toBe(pdf);
  });

  it('leaves every other link alone', () => {
    expect(unwrapViewerUrl('https://x.com/menu')).toBe('https://x.com/menu');
    expect(unwrapViewerUrl(pdf)).toBe(pdf);
    // another Google page with a url parameter is not a viewer
    expect(unwrapViewerUrl('https://docs.google.com/document/d/abc/edit?url=https://evil.com/a.pdf')).toBe(
      'https://docs.google.com/document/d/abc/edit?url=https://evil.com/a.pdf',
    );
    // a lookalike host is not a viewer
    expect(unwrapViewerUrl(`https://docs.google.com.evil.com/viewerng/viewer?url=${pdf}`)).toBe(
      `https://docs.google.com.evil.com/viewerng/viewer?url=${pdf}`,
    );
    expect(unwrapViewerUrl('not a link')).toBe('not a link');
  });

  it('ignores a viewer link with no usable address inside', () => {
    expect(unwrapViewerUrl('https://docs.google.com/viewerng/viewer')).toBe('https://docs.google.com/viewerng/viewer');
    expect(unwrapViewerUrl('https://docs.google.com/viewerng/viewer?url=javascript:alert(1)')).toBe(
      'https://docs.google.com/viewerng/viewer?url=javascript:alert(1)',
    );
    expect(unwrapViewerUrl('https://docs.google.com/viewerng/viewer?url=ftp://x.com/a.pdf')).toBe(
      'https://docs.google.com/viewerng/viewer?url=ftp://x.com/a.pdf',
    );
  });
});

describe('queue results', () => {
  it('maps a lookup result to one of the four outcomes the queue knows', () => {
    expect(mapResultToQueueStatus('ok')).toBe('ok');
    expect(mapResultToQueueStatus('no_menu_link')).toBe('no_menu_link');
    expect(mapResultToQueueStatus('no_place_id')).toBe('no_menu_link');
    expect(mapResultToQueueStatus('unreadable')).toBe('unreadable');
    expect(mapResultToQueueStatus('error')).toBe('error');
  });

  it('leaves the job alone for answers that are not outcomes', () => {
    for (const s of ['pending', 'in_progress', 'not_a_chain', 'weird', '', null, undefined]) {
      expect(mapResultToQueueStatus(s as any)).toBeNull();
    }
  });

  it('accepts only a positive whole number as a job id', () => {
    expect(parseJobId(7)).toBe(7);
    expect(parseJobId('42')).toBe(42);
    for (const bad of [0, -1, 1.5, 'abc', '4.2', '', null, undefined, NaN, {}, [], 9007199254740993]) {
      expect(parseJobId(bad as any)).toBeNull();
    }
  });
});

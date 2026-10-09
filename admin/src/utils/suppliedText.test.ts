// Tests for the helpers that handle menu text sent by the browser crawl worker (get-chain-menu, place mode).
import {
  chunkMenuText, cleanSuppliedText, mergeDishes, nutritionItemLines, sanitizeDishes, SUPPLIED_CHUNK_SIZE,
  SUPPLIED_TEXT_LIMIT,
} from '../../../supabase/functions/get-chain-menu/chainMenuUtils';

describe('cleanSuppliedText', () => {
  it('returns an empty string for anything that is not text', () => {
    for (const v of [undefined, null, 42, {}, [], true]) expect(cleanSuppliedText(v)).toBe('');
  });

  it('drops the reader\'s SOURCE header lines, control characters and runs of blank lines', () => {
    const raw = 'SOURCE: https://x.example.com/menu\r\n\r\n## Mains\r\n- Taco | 170 Cal\u0000\u0007\r\n\r\n\r\n\r\n- Burrito | 300 Cal\t extra\r\n';
    expect(cleanSuppliedText(raw)).toBe('## Mains\n- Taco | 170 Cal\n\n- Burrito | 300 Cal extra');
  });

  it('cuts the text at a line boundary within the limit', () => {
    const line = '- Dish number one | 100 Cal';
    const raw = Array.from({ length: 5000 }, () => line).join('\n');
    const out = cleanSuppliedText(raw);
    expect(out.length).toBeLessThanOrEqual(SUPPLIED_TEXT_LIMIT);
    expect(out.length).toBeGreaterThan(SUPPLIED_TEXT_LIMIT - 100);
    expect(out.split('\n').every((l) => l === line)).toBe(true);
    expect(cleanSuppliedText('a\nb\nc', 4)).toBe('a\nb');
  });
});

describe('chunkMenuText', () => {
  it('keeps short text in one piece', () => {
    expect(chunkMenuText('## Mains\n- Taco\n- Burrito')).toEqual(['## Mains\n- Taco\n- Burrito']);
  });

  it('splits long text at line boundaries, each piece within the size', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `- Dish ${i} | ${i} Cal`);
    const chunks = chunkMenuText(lines.join('\n'), 120);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(130);
    expect(chunks.join('\n').split('\n').filter((l) => l.startsWith('- ')).length).toBe(40);
  });

  it('starts a piece that begins mid-section with that section\'s heading again', () => {
    const text = ['## Burgers', ...Array.from({ length: 12 }, (_, i) => `- Burger ${i} | 500 Cal`), '## Sides', '- Fries | 300 Cal'].join('\n');
    const chunks = chunkMenuText(text, 120);
    expect(chunks[0].startsWith('## Burgers')).toBe(true);
    expect(chunks[1].startsWith('## Burgers')).toBe(true);
    expect(chunks[chunks.length - 1]).toContain('## Sides');
  });

  it('shortens a single huge line and returns nothing for empty text', () => {
    expect(chunkMenuText('x'.repeat(30000))[0].length).toBe(SUPPLIED_CHUNK_SIZE);
    expect(chunkMenuText('')).toEqual([]);
  });
});

describe('sanitizeDishes', () => {
  it('keeps names and the calories the page states', () => {
    expect(sanitizeDishes([{ name: 'Crunchy Taco', calories: 170 }, { name: 'Bean Burrito', calories: null }, 'Nachos'])).toEqual([
      { name: 'Crunchy Taco', calories: 170 },
      { name: 'Bean Burrito', calories: null },
      { name: 'Nachos', calories: null },
    ]);
  });

  it('cleans names like the name list does, drops duplicates and non-dishes', () => {
    const out = sanitizeDishes([
      { name: 'Big Mac $5.99', calories: 550 }, { name: 'big mac', calories: 560 }, { name: 'Home' }, { name: '12' },
      { name: '' }, null, 42, { notName: 'x' },
    ]);
    expect(out).toEqual([{ name: 'Big Mac', calories: 550 }]);
  });

  it('accepts only plausible whole-number calories', () => {
    const cals = (c: unknown) => sanitizeDishes([{ name: 'Dish One', calories: c }])[0].calories;
    expect(cals(1)).toBe(1);
    expect(cals(5000)).toBe(5000);
    expect(cals(170.6)).toBe(171);
    for (const bad of [0, -5, 5001, 'abc', null, undefined, NaN]) expect(cals(bad)).toBeNull();
    expect(cals('250')).toBe(250);
  });

  it('caps the list and ignores non-lists', () => {
    expect(sanitizeDishes(Array.from({ length: 20 }, (_, i) => ({ name: `Dish ${i}` })), 5)).toHaveLength(5);
    for (const v of [null, undefined, 'x', {}]) expect(sanitizeDishes(v)).toEqual([]);
  });
});

describe('mergeDishes', () => {
  it('keeps a dish once and keeps stated calories if either copy has them', () => {
    const merged = mergeDishes([
      [{ name: 'Taco', calories: null }, { name: 'Burrito', calories: 300 }],
      [{ name: 'taco', calories: 170 }, { name: 'Nachos', calories: null }],
    ]);
    expect(merged).toEqual([
      { name: 'Taco', calories: 170 }, { name: 'Burrito', calories: 300 }, { name: 'Nachos', calories: null },
    ]);
  });

  it('caps the list', () => {
    const list = Array.from({ length: 10 }, (_, i) => ({ name: `Dish ${i}`, calories: null }));
    expect(mergeDishes([list], 4)).toHaveLength(4);
    expect(mergeDishes([])).toEqual([]);
  });
});

describe('nutritionItemLines', () => {
  it('lists names, adding the stated calories where the menu has them', () => {
    const listed = new Map([['crunchy taco', 170]]);
    expect(nutritionItemLines(['Crunchy Taco', 'Nachos'], listed)).toBe(
      '- Crunchy Taco (calories listed on the menu: 170)\n- Nachos');
  });

  it('is a plain list without hints', () => {
    expect(nutritionItemLines(['A1', 'B2'])).toBe('- A1\n- B2');
    expect(nutritionItemLines(['A1'], null)).toBe('- A1');
    expect(nutritionItemLines(['A1'], new Map())).toBe('- A1');
  });
});

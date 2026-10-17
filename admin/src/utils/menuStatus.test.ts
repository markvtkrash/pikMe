// Tests for the menu status the nearby-restaurants edge function puts on each restaurant (fetch-nearby-restaurants/menuStatus.ts).
import { applyMenuStatus, menuStatusArgs, parseMenuStatusRows } from '../../../supabase/functions/fetch-nearby-restaurants/menuStatus';

describe('parseMenuStatusRows', () => {
  it('reads place ID → status', () => {
    const m = parseMenuStatusRows([
      { place_id: 'a', status: 'confirmed' },
      { place_id: 'b', status: 'estimated' },
      { place_id: 'c', status: 'none' },
    ]);
    expect(m.get('a')).toBe('confirmed');
    expect(m.get('b')).toBe('estimated');
    expect(m.get('c')).toBe('none');
    expect(m.size).toBe(3);
  });
  it('ignores unknown statuses, missing IDs and junk', () => {
    const m = parseMenuStatusRows([
      { place_id: 'a', status: 'verified' },
      { place_id: '', status: 'confirmed' },
      { status: 'confirmed' },
      { place_id: 5, status: 'confirmed' },
      { place_id: 'b', status: null },
      null,
      'x',
    ]);
    expect(m.size).toBe(0);
  });
  it('copes with a non-list answer', () => {
    expect(parseMenuStatusRows(null).size).toBe(0);
    expect(parseMenuStatusRows(undefined).size).toBe(0);
    expect(parseMenuStatusRows({ place_id: 'a', status: 'confirmed' }).size).toBe(0);
  });
});

describe('menuStatusArgs', () => {
  it('gives parallel arrays of IDs and names', () => {
    expect(menuStatusArgs([{ placeId: 'a', name: 'Taco Loco' }, { placeId: 'b', name: 'Pho 88' }]))
      .toEqual({ p_place_ids: ['a', 'b'], p_names: ['Taco Loco', 'Pho 88'] });
  });
  it('leaves out a restaurant with no ID, keeping the two arrays the same length', () => {
    const args = menuStatusArgs([{ placeId: 'a', name: 'A' }, { name: 'No id' }, { placeId: '', name: 'Empty' }, { placeId: 'b' }]);
    expect(args.p_place_ids).toEqual(['a', 'b']);
    expect(args.p_names).toEqual(['A', '']);
    expect(args.p_names.length).toBe(args.p_place_ids.length);
  });
  it('is empty for an empty list', () => {
    expect(menuStatusArgs([])).toEqual({ p_place_ids: [], p_names: [] });
  });
});

describe('applyMenuStatus', () => {
  const list = [{ placeId: 'a', name: 'A' }, { placeId: 'b', name: 'B' }, { placeId: 'c', name: 'C' }];
  it('puts each status on its own restaurant and keeps the rest of it', () => {
    const out = applyMenuStatus(list, new Map([['a', 'confirmed' as const], ['b', 'none' as const]]));
    expect(out[0]).toEqual({ placeId: 'a', name: 'A', menuStatus: 'confirmed' });
    expect(out[1]).toEqual({ placeId: 'b', name: 'B', menuStatus: 'none' });
  });
  it('gives no menuStatus to a restaurant the database did not answer for (unknown, not "none")', () => {
    const out = applyMenuStatus(list, new Map([['a', 'confirmed' as const]]));
    expect('menuStatus' in out[2]).toBe(false);
  });
  it('keeps order and count, and does not change the input', () => {
    const out = applyMenuStatus(list, new Map([['a', 'estimated' as const]]));
    expect(out.map((r) => r.placeId)).toEqual(['a', 'b', 'c']);
    expect('menuStatus' in list[0]).toBe(false);
  });
  it('does nothing without answers', () => {
    expect(applyMenuStatus(list, new Map())).toEqual(list);
  });
});

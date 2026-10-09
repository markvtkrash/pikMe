import { chooseMenuRows } from './menuRows';

const own = { item_id: 'own1', place_id: 'ChIJ_mine' };
const other = { item_id: 'other1', place_id: 'ChIJ_other' };
const shared = { item_id: 'shared1', place_id: null };
const shared2 = { item_id: 'shared2', place_id: undefined };

describe('chooseMenuRows', () => {
  it("returns the restaurant's own items when it has any", () => {
    expect(chooseMenuRows([own, other, shared], 'ChIJ_mine', false)).toEqual([own]);
    expect(chooseMenuRows([own, other, shared], 'ChIJ_mine', true)).toEqual([own]);
    expect(chooseMenuRows([own, shared], 'ChIJ_mine', undefined)).toEqual([own]);
  });

  it('gives an independent with no items of its own an EMPTY menu, not the shared list (the bug)', () => {
    expect(chooseMenuRows([other, shared, shared2], 'ChIJ_mine', false)).toEqual([]);
    expect(chooseMenuRows([], 'ChIJ_mine', false)).toEqual([]);
  });

  it('gives a franchise the shared chain menu when it has none of its own', () => {
    expect(chooseMenuRows([other, shared, shared2], 'ChIJ_mine', true)).toEqual([shared, shared2]);
  });

  it('keeps the shared fallback when it is not known whether it is a franchise', () => {
    expect(chooseMenuRows([other, shared], 'ChIJ_mine', undefined)).toEqual([shared]);
  });

  it('with no place, uses the shared rows (the older behaviour)', () => {
    expect(chooseMenuRows([own, shared, shared2], undefined, undefined)).toEqual([shared, shared2]);
    expect(chooseMenuRows([own, shared], null, false)).toEqual([shared]);
  });
});

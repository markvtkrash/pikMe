import { clampPage, LIST_PAGE_SIZE, pageCountFor, pageRange, pageSlice } from './paging';

const items = Array.from({ length: 120 }, (_, i) => i + 1);

describe('pageCountFor', () => {
  it('is at least one page, and rounds up', () => {
    expect(LIST_PAGE_SIZE).toBe(50);
    expect(pageCountFor(0)).toBe(1);
    expect(pageCountFor(50)).toBe(1);
    expect(pageCountFor(51)).toBe(2);
    expect(pageCountFor(120)).toBe(3);
    expect(pageCountFor(120, 10)).toBe(12);
  });
});

describe('clampPage', () => {
  it('keeps the page inside what exists', () => {
    expect(clampPage(0, 120)).toBe(0);
    expect(clampPage(2, 120)).toBe(2);
    expect(clampPage(9, 120)).toBe(2);
    expect(clampPage(-3, 120)).toBe(0);
    expect(clampPage(5, 0)).toBe(0);
    expect(clampPage(NaN, 120)).toBe(0);
  });
});

describe('pageSlice', () => {
  it('returns the rows of a page', () => {
    expect(pageSlice(items, 0)).toHaveLength(50);
    expect(pageSlice(items, 0)[0]).toBe(1);
    expect(pageSlice(items, 1)[0]).toBe(51);
    expect(pageSlice(items, 2)).toHaveLength(20);
    expect(pageSlice(items, 2)[19]).toBe(120);
  });
  it('shows the last page when asked for one past the end, and nothing for an empty list', () => {
    expect(pageSlice(items, 9)[0]).toBe(101);
    expect(pageSlice([], 0)).toEqual([]);
  });
});

describe('pageRange', () => {
  it('says which rows are shown', () => {
    expect(pageRange(0, 120)).toEqual({ from: 1, to: 50 });
    expect(pageRange(1, 120)).toEqual({ from: 51, to: 100 });
    expect(pageRange(2, 120)).toEqual({ from: 101, to: 120 });
    expect(pageRange(0, 7)).toEqual({ from: 1, to: 7 });
    expect(pageRange(0, 0)).toEqual({ from: 0, to: 0 });
  });
});

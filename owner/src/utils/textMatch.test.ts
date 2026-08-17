import { normalizeForSearch } from './textMatch';

describe('normalizeForSearch', () => {
  it('lowercases and strips apostrophes so "Dunkin Donuts" matches "Dunkin\' Donuts"', () => {
    expect(normalizeForSearch("Dunkin' Donuts")).toBe(normalizeForSearch('Dunkin Donuts'));
  });

  it('strips ampersands and spacing so "mac n cheese" matches "Mac & Cheese"', () => {
    expect(normalizeForSearch('Mac & Cheese')).toBe(normalizeForSearch('mac cheese'));
  });

  it('strips all non-alphanumeric characters', () => {
    expect(normalizeForSearch("O'Brien's Pub-N-Grill!")).toBe('obrienspubngrill');
  });

  it('returns an empty string for an empty or whitespace-only input', () => {
    expect(normalizeForSearch('')).toBe('');
    expect(normalizeForSearch('   ')).toBe('');
  });
});

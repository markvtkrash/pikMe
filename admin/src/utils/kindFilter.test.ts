// Tests for the server-side filter of franchise / independent restaurants (fetch-nearby-restaurants).
import { anyKindHidden, filterByKind, parseKindFlags, SHOW_ALL } from '../../../supabase/functions/fetch-nearby-restaurants/kindFilter';

describe('parseKindFlags', () => {
  it('shows both kinds when the rows are missing or empty', () => {
    expect(parseKindFlags(null)).toEqual(SHOW_ALL);
    expect(parseKindFlags(undefined)).toEqual(SHOW_ALL);
    expect(parseKindFlags([])).toEqual(SHOW_ALL);
  });

  it("turns a kind off only for the exact text 'false'", () => {
    expect(parseKindFlags([{ key: 'showFranchiseRestaurants', value: 'false' }])).toEqual({ showFranchise: false, showIndependent: true });
    expect(parseKindFlags([{ key: 'showIndependentRestaurants', value: 'false' }])).toEqual({ showFranchise: true, showIndependent: false });
    for (const value of ['true', 'FALSE', '0', '', null, 'no']) {
      expect(parseKindFlags([{ key: 'showFranchiseRestaurants', value }]).showFranchise).toBe(true);
    }
  });

  it('reads both flags from the same rows and ignores other keys', () => {
    expect(parseKindFlags([
      { key: 'showFranchiseRestaurants', value: 'false' },
      { key: 'showIndependentRestaurants', value: 'false' },
      { key: 'somethingElse', value: 'false' },
    ])).toEqual({ showFranchise: false, showIndependent: false });
  });
});

describe('filterByKind', () => {
  const list = [{ name: "McDonald's" }, { name: 'Cactus Grill' }, { name: ' Taco Bell ' }, { name: 'Joes Diner' }];
  const franchises = new Set(["McDonald's", 'Taco Bell']);

  it('returns the list as is when nothing is hidden', () => {
    expect(anyKindHidden(SHOW_ALL)).toBe(false);
    expect(filterByKind(list, franchises, SHOW_ALL)).toBe(list);
  });

  it('hides every franchise', () => {
    expect(filterByKind(list, franchises, { showFranchise: false, showIndependent: true }).map((r) => r.name))
      .toEqual(['Cactus Grill', 'Joes Diner']);
  });

  it('hides every independent', () => {
    expect(filterByKind(list, franchises, { showFranchise: true, showIndependent: false }).map((r) => r.name))
      .toEqual(["McDonald's", ' Taco Bell ']);
  });

  it('hides everything when both are off, and treats unknown names as independent', () => {
    expect(filterByKind(list, franchises, { showFranchise: false, showIndependent: false })).toEqual([]);
    expect(filterByKind(list, new Set(), { showFranchise: false, showIndependent: true })).toHaveLength(4);
  });

  it('tolerates a missing name', () => {
    expect(filterByKind([{ name: undefined as any }], franchises, { showFranchise: true, showIndependent: false })).toEqual([]);
  });
});

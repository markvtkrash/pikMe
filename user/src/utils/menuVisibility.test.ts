import { filterVisibleMenuItems } from './menuVisibility';

const verified = { itemId: 'v1', isVerified: true };
const unverified = { itemId: 'u1', isVerified: false };
const items = [verified, unverified];

describe('filterVisibleMenuItems', () => {
  // The full rule matrix: unconfirmed items show only if the global flag is
  // on OR the restaurant is a known franchise.
  it.each([
    // showUnconfirmed, isFranchise, expected item ids
    [false, false, ['v1']],
    [false, true, ['v1', 'u1']],
    [true, false, ['v1', 'u1']],
    [true, true, ['v1', 'u1']],
  ])('showUnconfirmed=%s isFranchise=%s -> %j', (showUnconfirmed, isFranchise, expectedIds) => {
    const result = filterVisibleMenuItems(items, { showUnconfirmed, isFranchise });
    expect(result.map((i) => i.itemId)).toEqual(expectedIds);
  });

  it('returns an empty list for an empty input regardless of rules', () => {
    expect(filterVisibleMenuItems([], { showUnconfirmed: false, isFranchise: false })).toEqual([]);
    expect(filterVisibleMenuItems([], { showUnconfirmed: true, isFranchise: true })).toEqual([]);
  });

  it('hides everything for a non-chain restaurant that only has unverified items', () => {
    const result = filterVisibleMenuItems([unverified, { itemId: 'u2', isVerified: false }], {
      showUnconfirmed: false,
      isFranchise: false,
    });
    expect(result).toEqual([]);
  });

  it('shows everything for a franchise that only has unverified items', () => {
    const result = filterVisibleMenuItems([unverified], { showUnconfirmed: false, isFranchise: true });
    expect(result).toEqual([unverified]);
  });

  it('keeps the original order of items', () => {
    const a = { itemId: 'a', isVerified: true };
    const b = { itemId: 'b', isVerified: false };
    const c = { itemId: 'c', isVerified: true };
    expect(
      filterVisibleMenuItems([a, b, c], { showUnconfirmed: false, isFranchise: false }).map((i) => i.itemId)
    ).toEqual(['a', 'c']);
    expect(
      filterVisibleMenuItems([a, b, c], { showUnconfirmed: false, isFranchise: true }).map((i) => i.itemId)
    ).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [verified, unverified];
    filterVisibleMenuItems(input, { showUnconfirmed: false, isFranchise: false });
    expect(input).toHaveLength(2);
  });

  it('treats a missing isVerified like unverified at runtime', () => {
    // Rows from before the column existed could come back without it.
    const legacy = { itemId: 'old' } as any;
    expect(filterVisibleMenuItems([legacy], { showUnconfirmed: false, isFranchise: false })).toEqual([]);
  });
});

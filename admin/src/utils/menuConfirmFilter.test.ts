import { matchesConfirmFilter, ConfirmFilter } from './menuConfirmFilter';

const noItems = { total_items: 0, verified_items: 0, unverified_items: 0 };
const onlyConfirmed = { total_items: 3, verified_items: 3, unverified_items: 0 };
const onlyUnconfirmed = { total_items: 2, verified_items: 0, unverified_items: 2 };
const mixed = { total_items: 5, verified_items: 2, unverified_items: 3 };

const rows = { noItems, onlyConfirmed, onlyUnconfirmed, mixed };

describe('matchesConfirmFilter', () => {
  it("'all' passes every row", () => {
    for (const row of Object.values(rows)) {
      expect(matchesConfirmFilter(row, 'all')).toBe(true);
    }
  });

  // Each row below belongs to exactly one non-'all' bucket — a true
  // partition, so e.g. an all-unconfirmed restaurant matches
  // 'only_unconfirmed' and nothing else (not also some broader "needs
  // review" bucket, which is what caused the confusing overlap before).
  const expected: Record<keyof typeof rows, ConfirmFilter> = {
    noItems: 'none',
    onlyConfirmed: 'only_confirmed',
    onlyUnconfirmed: 'only_unconfirmed',
    mixed: 'mixed',
  };

  const allFilters: ConfirmFilter[] = ['only_confirmed', 'only_unconfirmed', 'mixed', 'none'];

  for (const [rowName, row] of Object.entries(rows) as [keyof typeof rows, typeof noItems][]) {
    it(`${rowName} matches only its own bucket ('${expected[rowName]}')`, () => {
      for (const filter of allFilters) {
        expect(matchesConfirmFilter(row, filter)).toBe(filter === expected[rowName]);
      }
    });
  }
});

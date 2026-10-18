import { matchesFranchiseFilter } from './menuFranchiseFilter';

const franchise = { is_franchise: true };
const independent = { is_franchise: false };
const undeclared = {}; // is_franchise omitted, e.g. an older row

describe('matchesFranchiseFilter', () => {
  it("'all' passes every row", () => {
    for (const row of [franchise, independent, undeclared]) {
      expect(matchesFranchiseFilter(row, 'all')).toBe(true);
    }
  });

  it("'franchise' matches only is_franchise === true", () => {
    expect(matchesFranchiseFilter(franchise, 'franchise')).toBe(true);
    expect(matchesFranchiseFilter(independent, 'franchise')).toBe(false);
    expect(matchesFranchiseFilter(undeclared, 'franchise')).toBe(false);
  });

  it("'independent' matches false or missing is_franchise", () => {
    expect(matchesFranchiseFilter(independent, 'independent')).toBe(true);
    expect(matchesFranchiseFilter(undeclared, 'independent')).toBe(true);
    expect(matchesFranchiseFilter(franchise, 'independent')).toBe(false);
  });
});

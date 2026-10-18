// Franchise vs. independent filter for the admin Menu Management list. Pure helper so the rule can be tested.

export interface FranchiseRow {
  is_franchise?: boolean;
}

export type FranchiseFilter = 'all' | 'franchise' | 'independent';

export const FRANCHISE_FILTERS: { value: FranchiseFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'franchise', label: 'Franchise' },
  { value: 'independent', label: 'Independent' },
];

// is_franchise is optional — missing/false both mean independent.
export function matchesFranchiseFilter(row: FranchiseRow, filter: FranchiseFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'franchise':
      return row.is_franchise === true;
    case 'independent':
      return row.is_franchise !== true;
  }
}

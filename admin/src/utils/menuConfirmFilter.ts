// Confirmation-status filter for the admin Menu Management list. Pure helper so the rules can be tested.
//
// A restaurant's items split into exactly one of four buckets, by whether
// confirmed and/or unconfirmed items are present — a true partition, so
// every restaurant matches exactly one non-'all' filter below.

export interface ConfirmCountsRow {
  total_items: number;
  verified_items: number;
  unverified_items: number;
}

export type ConfirmFilter = 'all' | 'only_confirmed' | 'only_unconfirmed' | 'mixed' | 'none';

export const CONFIRM_FILTERS: { value: ConfirmFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'only_confirmed', label: 'Only confirmed present' },
  { value: 'only_unconfirmed', label: 'Only unconfirmed present' },
  { value: 'mixed', label: 'Both kinds' },
  { value: 'none', label: '0 items' },
];

// Does a restaurant's item counts pass the chosen confirmation-status filter?
export function matchesConfirmFilter(row: ConfirmCountsRow, filter: ConfirmFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'none':
      return row.total_items === 0;
    case 'only_confirmed':
      return row.verified_items > 0 && row.unverified_items === 0;
    case 'only_unconfirmed':
      return row.verified_items === 0 && row.unverified_items > 0;
    case 'mixed':
      return row.verified_items > 0 && row.unverified_items > 0;
  }
}

// The Franchise / Independent / All filter on the admin Manage Restaurants page. A restaurant is a franchise when its name is one of the
// names the database says belongs to a franchise (franchise_names_among, migration 126). An owner with no restaurant is neither.

export type OwnerKind = 'all' | 'franchise' | 'independent';

export const OWNER_KINDS: { key: OwnerKind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'franchise', label: 'Franchise' },
  { key: 'independent', label: 'Independent' },
];

export function matchesOwnerKind(restaurantName: string | null | undefined, franchiseNames: Set<string>, kind: OwnerKind): boolean {
  if (kind === 'all') return true;
  const name = (restaurantName ?? '').trim();
  if (!name) return false;
  const isFranchise = franchiseNames.has(name);
  return kind === 'franchise' ? isFranchise : !isFranchise;
}

export function countByKind(
  rows: { restaurant_name: string | null }[],
  franchiseNames: Set<string>
): Record<OwnerKind, number> {
  return {
    all: rows.length,
    franchise: rows.filter((r) => matchesOwnerKind(r.restaurant_name, franchiseNames, 'franchise')).length,
    independent: rows.filter((r) => matchesOwnerKind(r.restaurant_name, franchiseNames, 'independent')).length,
  };
}

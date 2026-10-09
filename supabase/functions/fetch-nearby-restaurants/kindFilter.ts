// Which kinds of restaurants customers see (app_config 'showFranchiseRestaurants' / 'showIndependentRestaurants',
// migration 126). Pure helpers, kept apart from index.ts so they can be unit tested. A missing, unreadable or unrecognised
// flag counts as "show", so nothing disappears by accident. Only the exact text 'false' turns a kind off.

export interface KindFlags {
  showFranchise: boolean;
  showIndependent: boolean;
}

export const SHOW_ALL: KindFlags = { showFranchise: true, showIndependent: true };

export function parseKindFlags(rows: { key: string; value: string | null }[] | null | undefined): KindFlags {
  const get = (key: string) => (rows ?? []).find((r) => r.key === key)?.value;
  return {
    showFranchise: get('showFranchiseRestaurants') !== 'false',
    showIndependent: get('showIndependentRestaurants') !== 'false',
  };
}

export function anyKindHidden(flags: KindFlags): boolean {
  return !flags.showFranchise || !flags.showIndependent;
}

// Keeps the restaurants of the kinds that are on. `franchiseNames` are the names (as listed) that are franchises.
export function filterByKind<T extends { name: string }>(restaurants: T[], franchiseNames: Set<string>, flags: KindFlags): T[] {
  if (!anyKindHidden(flags)) return restaurants;
  return restaurants.filter((r) => (franchiseNames.has(String(r.name ?? '').trim()) ? flags.showFranchise : flags.showIndependent));
}

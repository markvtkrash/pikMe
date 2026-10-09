// The filters a customer has chosen, shown as small removable chips under the Filters button on the Explore page (the choosing
// itself happens in the filter sheet). Pure helpers, kept apart from the screen so they can be unit tested.

import { CategoryFilters, labelFor, RestaurantCategory } from './categories';

export type ChipKind = 'venue' | 'service' | 'cuisine' | 'legacyType' | 'legacyCuisine';

export interface ActiveChip {
  id: string;
  label: string;
  kind: ChipKind;
  key: string;
}

// The earlier single-choice filters, used when the server does not send categories.
export interface LegacySelection {
  type: string | null;
  cuisine: string | null;
  typeLabel: (type: string) => string;
}

// One chip per chosen filter, in the order the groups appear in the sheet.
export function activeChips(filters: CategoryFilters, categories: RestaurantCategory[], legacy: LegacySelection | null): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const key of filters.venues) chips.push({ id: `venue:${key}`, label: labelFor(categories, key), kind: 'venue', key });
  for (const key of filters.services) chips.push({ id: `service:${key}`, label: labelFor(categories, key), kind: 'service', key });
  for (const key of filters.cuisines) chips.push({ id: `cuisine:${key}`, label: labelFor(categories, key), kind: 'cuisine', key });
  if (legacy?.type) chips.push({ id: `legacyType:${legacy.type}`, label: legacy.typeLabel(legacy.type), kind: 'legacyType', key: legacy.type });
  if (legacy?.cuisine) chips.push({ id: `legacyCuisine:${legacy.cuisine}`, label: legacy.cuisine, kind: 'legacyCuisine', key: legacy.cuisine });
  return chips;
}

// The filters without one chip's choice. Legacy chips are removed by the screen (they are not part of CategoryFilters).
export function removeChip(filters: CategoryFilters, chip: ActiveChip): CategoryFilters {
  switch (chip.kind) {
    case 'venue': return { ...filters, venues: filters.venues.filter((k) => k !== chip.key) };
    case 'service': return { ...filters, services: filters.services.filter((k) => k !== chip.key) };
    case 'cuisine': return { ...filters, cuisines: filters.cuisines.filter((k) => k !== chip.key) };
    default: return filters;
  }
}

// How many chips fit on the page: the first `max`, and how many more there are ("+3 more").
export function splitChips(chips: ActiveChip[], max = 4): { shown: ActiveChip[]; more: number } {
  return { shown: chips.slice(0, max), more: Math.max(0, chips.length - max) };
}

// The button for the sheet: "Filters", or "Filters (3)".
export function filtersButtonLabel(count: number): string {
  return count > 0 ? `Filters (${count})` : 'Filters';
}

// The button at the bottom of the sheet: "Show 12 places".
export function showResultsLabel(count: number): string {
  if (count === 0) return 'No places match';
  return `Show ${count} place${count === 1 ? '' : 's'}`;
}

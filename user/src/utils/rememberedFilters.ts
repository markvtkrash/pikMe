// "Remember my filters": the restaurant filters (kind of place, how you get the food, cuisine) the person last chose are kept on their device and
// used again the next time Explore opens. Pure rules, so they can be tested without a screen.
import {
  anyCategoryFilter, matchesCategoryFilters, NO_CATEGORY_FILTERS,
  type CategorizedRestaurant, type CategoryFilters, type RestaurantCategory,
} from './categories';

const MAX_PER_GROUP = 30;

function cleanKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_PER_GROUP) break;
  }
  return out;
}

/** Whatever was stored, as filters we can trust: three lists of distinct non-empty strings, anything else dropped. */
export function sanitizeFilters(raw: unknown): CategoryFilters {
  if (!raw || typeof raw !== 'object') return NO_CATEGORY_FILTERS;
  const r = raw as Record<string, unknown>;
  return { venues: cleanKeys(r.venues), services: cleanKeys(r.services), cuisines: cleanKeys(r.cuisines) };
}

/** Drops remembered choices an admin has since removed from the category list. With no list yet, nothing is dropped. */
export function keepKnownKeys(filters: CategoryFilters, categories: RestaurantCategory[]): CategoryFilters {
  if (categories.length === 0) return filters;
  const known = (grp: RestaurantCategory['grp']) => new Set(categories.filter((c) => c.grp === grp).map((c) => c.key));
  const venues = known('venue');
  const services = known('service');
  const cuisines = known('cuisine');
  return {
    venues: filters.venues.filter((k) => venues.has(k)),
    services: filters.services.filter((k) => services.has(k)),
    cuisines: filters.cuisines.filter((k) => cuisines.has(k)),
  };
}

export type RestorePlan =
  | { applied: false; reason: 'nothing-saved' | 'no-matches'; filters: CategoryFilters }
  | { applied: true; reason: 'applied'; filters: CategoryFilters };

/** What to start Explore with. The remembered filters are used when they still exist and at least one restaurant here matches them; otherwise Explore
 *  starts unfiltered (a list that opens empty looks broken). The remembered choice is left as it is, to be used where it does fit. */
export function planRestore(saved: CategoryFilters, restaurants: CategorizedRestaurant[], categories: RestaurantCategory[]): RestorePlan {
  const filters = keepKnownKeys(sanitizeFilters(saved), categories);
  if (!anyCategoryFilter(filters)) return { applied: false, reason: 'nothing-saved', filters: NO_CATEGORY_FILTERS };
  if (!restaurants.some((r) => matchesCategoryFilters(r, filters))) return { applied: false, reason: 'no-matches', filters: NO_CATEGORY_FILTERS };
  return { applied: true, reason: 'applied', filters };
}

/** True when the restoring is still to be decided: the stored choice has been read, the restaurants are in, and nothing has been chosen yet. */
export function readyToRestore(state: { hydrated: boolean; restaurantCount: number; alreadyDecided: boolean; currentlyFiltered: boolean }): boolean {
  return state.hydrated && state.restaurantCount > 0 && !state.alreadyDecided && !state.currentlyFiltered;
}

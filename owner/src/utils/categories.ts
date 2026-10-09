// Restaurant categories on the owner site (migration 129): what the place is (venue), how you get the food (service) and what it
// serves (cuisine), each its own group with several choices. The list of categories comes from the server (an admin manages it),
// so nothing here hard-codes the names.

export type CategoryGroup = 'venue' | 'service' | 'cuisine';

export interface RestaurantCategory {
  key: string;
  grp: CategoryGroup;
  label: string;
  sort_order: number;
}

export interface CategoryChoice {
  venueTypes: string[];
  services: string[];
  cuisines: string[];
}

export const GROUP_TITLES: Record<CategoryGroup, { title: string; hint: string }> = {
  venue: { title: 'What is your place?', hint: 'Choose everything that fits. At least one is needed.' },
  service: { title: 'How can customers get the food?', hint: 'Turn on each way you offer it.' },
  cuisine: { title: 'What do you serve?', hint: 'Optional. Choose the cuisines that fit.' },
};

export const EMPTY_CHOICE: CategoryChoice = { venueTypes: [], services: [], cuisines: [] };

const GROUPS: CategoryGroup[] = ['venue', 'service', 'cuisine'];

// The categories the server sent, keeping only well-formed ones.
export function parseCategories(raw: unknown): RestaurantCategory[] {
  if (!Array.isArray(raw)) return [];
  const out: RestaurantCategory[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.key !== 'string' || !r.key || typeof r.label !== 'string' || !r.label.trim()) continue;
    if (!GROUPS.includes(r.grp as CategoryGroup)) continue;
    out.push({ key: r.key, grp: r.grp as CategoryGroup, label: r.label.trim(), sort_order: Number(r.sort_order) || 0 });
  }
  return out;
}

export function categoriesByGroup(list: RestaurantCategory[]): Record<CategoryGroup, RestaurantCategory[]> {
  const sorted = [...list].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  return {
    venue: sorted.filter((c) => c.grp === 'venue'),
    service: sorted.filter((c) => c.grp === 'service'),
    cuisine: sorted.filter((c) => c.grp === 'cuisine'),
  };
}

// Adds the key when it is not in the list, removes it when it is.
export function toggleKey(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}

// Google's guess (rows of { key, grp } from categorize_google_types) as a choice.
export function choiceFromGuess(rows: unknown): CategoryChoice {
  const out: CategoryChoice = { venueTypes: [], services: [], cuisines: [] };
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { key, grp } = row as { key?: unknown; grp?: unknown };
    if (typeof key !== 'string') continue;
    const list = grp === 'venue' ? out.venueTypes : grp === 'service' ? out.services : grp === 'cuisine' ? out.cuisines : null;
    if (list && !list.includes(key)) list.push(key);
  }
  return out;
}

// What to show an owner: their saved choice per group, else Google's guess for a group they have not set.
export function choiceForEditing(
  saved: { venue_types?: string[] | null; services?: string[] | null; cuisines?: string[] | null } | null | undefined,
  guess: CategoryChoice
): CategoryChoice {
  return {
    venueTypes: Array.isArray(saved?.venue_types) ? saved!.venue_types! : guess.venueTypes,
    services: Array.isArray(saved?.services) ? saved!.services! : guess.services,
    cuisines: Array.isArray(saved?.cuisines) ? saved!.cuisines! : guess.cuisines,
  };
}

// Place types that almost always have seating: for these, Dine-in is pre-ticked as a suggestion the owner can untick. Google says
// nothing about seating, and a cafe or food truck often has none, so no other place type gets it.
const DINE_IN_SUGGESTED_FOR = ['restaurant', 'bar'];

// Adds Dine-in to a choice that has a Restaurant or Bar place type, when that way to order exists on the server. Returns the choice
// unchanged otherwise (also when the owner already ticked it).
export function suggestDineIn(choice: CategoryChoice, list: RestaurantCategory[]): CategoryChoice {
  const offered = list.some((c) => c.grp === 'service' && c.key === 'dine_in');
  const seating = choice.venueTypes.some((v) => DINE_IN_SUGGESTED_FOR.includes(v));
  if (!offered || !seating || choice.services.includes('dine_in')) return choice;
  return { ...choice, services: [...choice.services, 'dine_in'] };
}

// Drops keys the server does not offer (a category that was switched off or never existed), keeping the server's order.
export function cleanChoice(choice: CategoryChoice, list: RestaurantCategory[]): CategoryChoice {
  const by = categoriesByGroup(list);
  const keep = (keys: string[], grp: CategoryGroup) => by[grp].filter((c) => keys.includes(c.key)).map((c) => c.key);
  return { venueTypes: keep(choice.venueTypes, 'venue'), services: keep(choice.services, 'service'), cuisines: keep(choice.cuisines, 'cuisine') };
}

// The one required thing: at least one place type.
export function validateChoice(choice: CategoryChoice): string | null {
  return choice.venueTypes.length === 0 ? 'Choose at least one thing your place is, for example Restaurant or Cafe.' : null;
}

// True when the owner has not told us what their place is yet (the dashboard nudge).
export function needsCategories(restaurant: { venue_types?: string[] | null } | null | undefined): boolean {
  return !!restaurant && !Array.isArray(restaurant.venue_types);
}

// Two choices are the same set of keys in each group (order does not matter).
export function sameChoice(a: CategoryChoice, b: CategoryChoice): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((k) => y.includes(k));
  return same(a.venueTypes, b.venueTypes) && same(a.services, b.services) && same(a.cuisines, b.cuisines);
}

// Restaurant categories in the admin site (migration 129): the Tools -> Restaurant Categories page and the per-restaurant editor.
// Pure helpers: reading what the server sent, and building what to send, with the same checks the database makes.

export type CategoryGroup = 'venue' | 'service' | 'cuisine';

export interface AdminCategory {
  key: string;
  grp: CategoryGroup;
  label: string;
  sort_order: number;
  is_active: boolean;
  // how many restaurants have it chosen
  restaurants: number;
}

export interface CategoryMapping {
  google_type: string;
  category_key: string;
}

export const GROUP_LABELS: Record<CategoryGroup, string> = {
  venue: 'What the place is',
  service: 'Ways to get the food',
  cuisine: 'Cuisine',
};

export const GROUP_ORDER: CategoryGroup[] = ['venue', 'service', 'cuisine'];

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const GOOGLE_TYPE_RE = /^[a-z][a-z0-9_]{0,79}$/;

export function parseAdminCategories(raw: unknown): { categories: AdminCategory[]; mappings: CategoryMapping[] } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const categories: AdminCategory[] = [];
  for (const item of Array.isArray(r.categories) ? r.categories : []) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if (typeof c.key !== 'string' || typeof c.label !== 'string' || !GROUP_ORDER.includes(c.grp as CategoryGroup)) continue;
    categories.push({
      key: c.key, grp: c.grp as CategoryGroup, label: c.label, sort_order: Number(c.sort_order) || 0,
      is_active: c.is_active !== false, restaurants: Number(c.restaurants) || 0,
    });
  }
  const mappings: CategoryMapping[] = [];
  for (const item of Array.isArray(r.mappings) ? r.mappings : []) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    if (typeof m.google_type === 'string' && typeof m.category_key === 'string') mappings.push({ google_type: m.google_type, category_key: m.category_key });
  }
  return { categories, mappings };
}

export function categoriesInGroup(list: AdminCategory[], grp: CategoryGroup): AdminCategory[] {
  return list.filter((c) => c.grp === grp).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

// The Google types that count as this category.
export function mappedTypes(mappings: CategoryMapping[], key: string): string[] {
  return mappings.filter((m) => m.category_key === key).map((m) => m.google_type).sort();
}

// Checks a new or edited category the way the database will. Returns what to send, or the first problem in plain words.
export function buildCategoryInput(input: {
  key: string; grp: CategoryGroup | ''; label: string; sortOrder: string; isActive: boolean; isNew: boolean;
}): { ok: true; value: { key: string; grp: CategoryGroup; label: string; sortOrder: number; isActive: boolean } } | { ok: false; error: string } {
  const key = input.key.trim().toLowerCase();
  const label = input.label.trim();
  if (!input.grp) return { ok: false, error: 'Choose a group.' };
  if (!KEY_RE.test(key)) return { ok: false, error: 'The key must be lowercase letters, numbers and underscores, starting with a letter (for example food_truck).' };
  if (!label) return { ok: false, error: 'Write the name people will see.' };
  if (label.length > 40) return { ok: false, error: 'The name can be at most 40 characters.' };
  const sortText = input.sortOrder.trim();
  if (sortText !== '' && !/^-?\d{1,6}$/.test(sortText)) return { ok: false, error: 'The order must be a whole number.' };
  return { ok: true, value: { key, grp: input.grp, label, sortOrder: sortText === '' ? 100 : Number(sortText), isActive: input.isActive } };
}

// A Google place type typed by an admin, cleaned, or null when it is not one.
export function cleanGoogleType(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '_');
  return GOOGLE_TYPE_RE.test(t) ? t : null;
}

// ── One restaurant ──────────────────────────────────────────────────────────
// Per group: 'google' = no choice saved (Google's guess is used), or 'custom' with the chosen keys.
export interface GroupState {
  custom: boolean;
  keys: string[];
}

export interface RestaurantCategoryStates {
  venue: GroupState;
  service: GroupState;
  cuisine: GroupState;
}

export interface RestaurantCategoriesFromServer {
  venue_types: string[] | null;
  services: string[] | null;
  cuisines: string[] | null;
  google_types: string[];
  google_guess: { key: string; grp: CategoryGroup }[];
}

export function parseRestaurantCategories(raw: unknown): RestaurantCategoriesFromServer {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);
  const guess = Array.isArray(r.google_guess)
    ? r.google_guess.filter((g): g is { key: string; grp: CategoryGroup } => !!g && typeof (g as any).key === 'string' && GROUP_ORDER.includes((g as any).grp))
    : [];
  return { venue_types: list(r.venue_types), services: list(r.services), cuisines: list(r.cuisines), google_types: list(r.google_types) ?? [], google_guess: guess };
}

export function statesFromServer(s: RestaurantCategoriesFromServer): RestaurantCategoryStates {
  return {
    venue: { custom: Array.isArray(s.venue_types), keys: s.venue_types ?? [] },
    service: { custom: Array.isArray(s.services), keys: s.services ?? [] },
    cuisine: { custom: Array.isArray(s.cuisines), keys: s.cuisines ?? [] },
  };
}

// Google's guess for one group, as keys.
export function guessKeys(s: RestaurantCategoriesFromServer, grp: CategoryGroup): string[] {
  return s.google_guess.filter((g) => g.grp === grp).map((g) => g.key);
}

// What to send: null for a group left on Google's guess. A custom place type list cannot be empty.
export function buildRestaurantCategoryArgs(
  states: RestaurantCategoryStates
): { ok: true; value: { venueTypes: string[] | null; services: string[] | null; cuisines: string[] | null } } | { ok: false; error: string } {
  if (states.venue.custom && states.venue.keys.length === 0) return { ok: false, error: 'Choose at least one place type, or switch it back to Google\'s guess.' };
  return {
    ok: true,
    value: {
      venueTypes: states.venue.custom ? states.venue.keys : null,
      services: states.service.custom ? states.service.keys : null,
      cuisines: states.cuisine.custom ? states.cuisine.keys : null,
    },
  };
}

export function toggleKey(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}

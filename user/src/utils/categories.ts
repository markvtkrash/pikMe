// Restaurant categories in the customer app (migration 129): what a place is (venue), how you get the food (service) and what it
// serves (cuisine), each its own group with several values per restaurant. The server sends the list of categories (an admin
// manages it) and, for every restaurant, its venueTypes, services and cuisines as category keys. Filtering rules:
//   - inside a group, a restaurant needs ANY of the chosen values (Cafe or Bar);
//   - ways to order are switches that must ALL be on (Takeaway and Delivery);
//   - between groups, a restaurant needs to match every group that has a choice.
// An older server that does not send these fields falls back to the earlier behaviour (the screens check `isCurated`).

import { CUISINE_FILTERS } from '../constants/cuisines';

export type CategoryGroup = 'venue' | 'service' | 'cuisine';

export interface RestaurantCategory {
  key: string;
  grp: CategoryGroup;
  label: string;
  sort_order: number;
}

export interface CategorizedRestaurant {
  name: string;
  cuisineTypes: string[];
  venueTypes?: string[];
  services?: string[];
  cuisines?: string[];
  ownerCategories?: boolean;
}

const GROUPS: CategoryGroup[] = ['venue', 'service', 'cuisine'];

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

// True when the server sent the three category lists, so the curated filters can be used.
export function isCurated(restaurants: CategorizedRestaurant[], categories: RestaurantCategory[]): boolean {
  return categories.length > 0 && restaurants.some((r) => Array.isArray(r.venueTypes));
}

function inGroup(categories: RestaurantCategory[], grp: CategoryGroup): RestaurantCategory[] {
  return categories.filter((c) => c.grp === grp).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

// A cuisine the restaurant has: from the server's list, or (when the owner chose nothing and the server found none) the earlier
// match on Google types and words in the name, so a place such as "Pizza Palace" is still found under Italian.
export function hasCuisine(r: CategorizedRestaurant, key: string): boolean {
  if (r.cuisines?.includes(key)) return true;
  if (r.ownerCategories) return false;
  const legacy = CUISINE_FILTERS.find((c) => c.label.toLowerCase() === key);
  if (!legacy) return false;
  if (r.cuisineTypes.some((t) => legacy.types.includes(t))) return true;
  const name = r.name.toLowerCase();
  return legacy.keywords.some((kw) => name.includes(kw));
}

// The chips to show: only categories that at least one of these restaurants has, in the server's order.
export function venueOptions(restaurants: CategorizedRestaurant[], categories: RestaurantCategory[]): RestaurantCategory[] {
  return inGroup(categories, 'venue').filter((c) => restaurants.some((r) => r.venueTypes?.includes(c.key)));
}
export function serviceOptions(restaurants: CategorizedRestaurant[], categories: RestaurantCategory[]): RestaurantCategory[] {
  return inGroup(categories, 'service').filter((c) => restaurants.some((r) => r.services?.includes(c.key)));
}
export function cuisineOptions(restaurants: CategorizedRestaurant[], categories: RestaurantCategory[]): RestaurantCategory[] {
  return inGroup(categories, 'cuisine').filter((c) => restaurants.some((r) => hasCuisine(r, c.key)));
}

export interface CategoryFilters {
  venues: string[];
  services: string[];
  cuisines: string[];
}

export const NO_CATEGORY_FILTERS: CategoryFilters = { venues: [], services: [], cuisines: [] };

export function anyCategoryFilter(f: CategoryFilters): boolean {
  return f.venues.length > 0 || f.services.length > 0 || f.cuisines.length > 0;
}

export function toggleFilter(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}

// A restaurant passes when it matches every group that has a choice: any chosen place type, all chosen ways to order, any chosen cuisine.
export function matchesCategoryFilters(r: CategorizedRestaurant, f: CategoryFilters): boolean {
  if (f.venues.length > 0 && !f.venues.some((k) => r.venueTypes?.includes(k))) return false;
  if (f.services.length > 0 && !f.services.every((k) => r.services?.includes(k))) return false;
  if (f.cuisines.length > 0 && !f.cuisines.some((k) => hasCuisine(r, k))) return false;
  return true;
}

export function labelFor(categories: RestaurantCategory[], key: string): string {
  return categories.find((c) => c.key === key)?.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

// A short line for a restaurant card: what it is and what it serves, from the categories. Null when the server did not send them
// (the caller then shows the earlier text).
export function describeCategories(r: CategorizedRestaurant, categories: RestaurantCategory[], max = 2): string | null {
  if (!Array.isArray(r.venueTypes) || categories.length === 0) return null;
  const keys = [...(r.venueTypes ?? []), ...(r.cuisines ?? [])];
  const labels = keys.map((k) => labelFor(categories, k));
  return labels.length > 0 ? labels.slice(0, max).join(' · ') : null;
}

// Restaurant categories (migration 129): what a place is (venue), how you get the food (service) and what it serves (cuisine), each
// kept in its OWN group and each allowing several values. Pure helpers, kept apart from index.ts so they can be unit tested.
//
//   - Google's place types are sorted into the three groups through a mapping (a table in the database; DEFAULT_CATALOG below is
//     the safety net when the table cannot be read, and must match the seed in migration 129).
//   - An owner's saved choice for a group replaces Google's guess for THAT group only. A group the owner has not chosen
//     (null) uses Google's guess. A chosen empty list (services, cuisines) means "none" and is kept.
//   - A place with no place type from Google is a Restaurant.

export type CategoryGroup = 'venue' | 'service' | 'cuisine';

export interface CategoryDef {
  key: string;
  grp: CategoryGroup;
}

export interface CategoryMapRow {
  google_type: string;
  category_key: string;
}

export interface Catalog {
  // the active categories, in display order
  categories: CategoryDef[];
  map: CategoryMapRow[];
}

export interface OwnerCategories {
  venue_types: string[] | null;
  services: string[] | null;
  cuisines: string[] | null;
}

export interface ResolvedCategories {
  venueTypes: string[];
  services: string[];
  cuisines: string[];
  // true when the owner chose at least one of the groups
  ownerCategories: boolean;
}

const V = (key: string): CategoryDef => ({ key, grp: 'venue' });
const S = (key: string): CategoryDef => ({ key, grp: 'service' });
const C = (key: string): CategoryDef => ({ key, grp: 'cuisine' });

export const DEFAULT_CATALOG: Catalog = {
  categories: [
    V('restaurant'), V('cafe'), V('bar'), V('bakery'), V('fast_food'), V('dessert'), V('juice'), V('food_truck'),
    S('dine_in'), S('takeaway'), S('delivery'), S('drive_thru'),
    C('italian'), C('mexican'), C('indian'), C('chinese'), C('japanese'), C('thai'), C('asian'), C('mediterranean'),
    C('american'), C('french'), C('seafood'), C('other'),
  ],
  map: [
    ['restaurant', 'restaurant'],
    ['cafe', 'cafe'], ['coffee_shop', 'cafe'],
    ['bar', 'bar'], ['pub', 'bar'], ['night_club', 'bar'], ['wine_bar', 'bar'],
    ['bakery', 'bakery'],
    ['fast_food_restaurant', 'fast_food'],
    ['ice_cream_shop', 'dessert'], ['dessert_shop', 'dessert'],
    ['juice_shop', 'juice'],
    ['meal_takeaway', 'takeaway'],
    ['meal_delivery', 'delivery'],
    ['italian_restaurant', 'italian'], ['pizza_restaurant', 'italian'],
    ['mexican_restaurant', 'mexican'],
    ['indian_restaurant', 'indian'],
    ['chinese_restaurant', 'chinese'],
    ['japanese_restaurant', 'japanese'], ['sushi_restaurant', 'japanese'], ['ramen_restaurant', 'japanese'],
    ['thai_restaurant', 'thai'],
    ['asian_restaurant', 'asian'], ['korean_restaurant', 'asian'], ['vietnamese_restaurant', 'asian'],
    ['mediterranean_restaurant', 'mediterranean'], ['greek_restaurant', 'mediterranean'], ['turkish_restaurant', 'mediterranean'],
    ['lebanese_restaurant', 'mediterranean'], ['middle_eastern_restaurant', 'mediterranean'],
    ['american_restaurant', 'american'], ['hamburger_restaurant', 'american'], ['barbecue_restaurant', 'american'], ['steak_house', 'american'],
    ['french_restaurant', 'french'],
    ['seafood_restaurant', 'seafood'],
  ].map(([google_type, category_key]) => ({ google_type, category_key })),
};

// Keeps only the keys that are active categories of the given group, once each, in the catalog's order.
function keepKnown(keys: string[], grp: CategoryGroup, catalog: Catalog): string[] {
  const wanted = new Set(keys);
  return catalog.categories.filter((c) => c.grp === grp && wanted.has(c.key)).map((c) => c.key);
}

// Google's guess for a list of Google place types.
export function guessCategories(googleTypes: unknown, catalog: Catalog = DEFAULT_CATALOG): Pick<ResolvedCategories, 'venueTypes' | 'services' | 'cuisines'> {
  const types = new Set((Array.isArray(googleTypes) ? googleTypes : []).filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase()));
  const hit = new Set(catalog.map.filter((m) => types.has(m.google_type)).map((m) => m.category_key));
  let venueTypes = keepKnown([...hit], 'venue', catalog);
  if (venueTypes.length === 0 && catalog.categories.some((c) => c.key === 'restaurant' && c.grp === 'venue')) venueTypes = ['restaurant'];
  return {
    venueTypes,
    services: keepKnown([...hit], 'service', catalog),
    cuisines: keepKnown([...hit], 'cuisine', catalog),
  };
}

// The categories to show for a restaurant: the owner's choice per group where there is one, else Google's guess.
export function resolveCategories(googleTypes: unknown, owner: OwnerCategories | null | undefined, catalog: Catalog = DEFAULT_CATALOG): ResolvedCategories {
  const guess = guessCategories(googleTypes, catalog);
  const own = owner ?? { venue_types: null, services: null, cuisines: null };

  // an owner's venue list that no longer holds any active category (for example it was switched off) falls back to the guess
  const ownVenue = Array.isArray(own.venue_types) ? keepKnown(own.venue_types, 'venue', catalog) : null;
  const venueTypes = ownVenue && ownVenue.length > 0 ? ownVenue : guess.venueTypes;
  const services = Array.isArray(own.services) ? keepKnown(own.services, 'service', catalog) : guess.services;
  const cuisines = Array.isArray(own.cuisines) ? keepKnown(own.cuisines, 'cuisine', catalog) : guess.cuisines;

  return {
    venueTypes,
    services,
    cuisines,
    ownerCategories: Array.isArray(own.venue_types) || Array.isArray(own.services) || Array.isArray(own.cuisines),
  };
}

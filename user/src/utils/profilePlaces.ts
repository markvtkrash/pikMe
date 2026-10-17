// The profile's place choices (kind of place, how you get the food, cuisine) use the SAME category list as the Explore filters and the owner's three
// questions (restaurant_categories, managed by an admin). These are the pure rules that connect them, so they can be tested without a screen.
import {
  anyCategoryFilter, matchesCategoryFilters, NO_CATEGORY_FILTERS,
  type CategorizedRestaurant, type CategoryFilters, type CategoryGroup, type RestaurantCategory,
} from './categories';
import { keepKnownKeys, planRestore, sanitizeFilters, type RestorePlan } from './rememberedFilters';

export interface ProfilePlacePrefs {
  venuePreferences?: string[] | null;
  servicePreferences?: string[] | null;
  cuisinePreferences?: string[] | null;
}

/** The categories of one group, in the order an admin set, as chip options. */
export function categoryChoices(categories: RestaurantCategory[], grp: CategoryGroup): { value: string; label: string }[] {
  return categories
    .filter((c) => c.grp === grp)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
    .map((c) => ({ value: c.key, label: c.label }));
}

/** The labels of the chosen keys, in the admin's order. A key that is no longer a category of that group is left out. */
export function choiceLabels(keys: string[] | null | undefined, categories: RestaurantCategory[], grp: CategoryGroup): string[] {
  const chosen = new Set(keys ?? []);
  return categoryChoices(categories, grp).filter((c) => chosen.has(c.value)).map((c) => c.label);
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && k !== '') : []);

/** The profile's choices as filters, keeping only keys that are categories of the right group right now. */
export function profileStartFilters(prefs: ProfilePlacePrefs | null | undefined, categories: RestaurantCategory[]): CategoryFilters {
  if (!prefs) return NO_CATEGORY_FILTERS;
  const raw = sanitizeFilters({ venues: list(prefs.venuePreferences), services: list(prefs.servicePreferences), cuisines: list(prefs.cuisinePreferences) });
  // with no category list yet nothing can be checked, so nothing is used (unlike a person's own remembered filters)
  if (categories.length === 0) return NO_CATEGORY_FILTERS;
  return keepKnownKeys(raw, categories);
}

/** A short text that changes whenever the profile's choices change: the same choices in any order give the same text, none at all gives "". It is how
 *  Explore knows the profile was edited since it last started from it. */
export function profileSignature(prefs: ProfilePlacePrefs | null | undefined): string {
  if (!prefs) return '';
  const part = (tag: string, keys: unknown) => `${tag}:${[...new Set(list(keys))].sort().join(',')}`;
  const sig = [part('v', prefs.venuePreferences), part('s', prefs.servicePreferences), part('c', prefs.cuisinePreferences)].join('|');
  return sig === 'v:|s:|c:' ? '' : sig;
}

/** How many of the restaurants that fit the other choices also offer every chosen way to get food. The ordering choices are patchy for restaurants
 *  nobody has claimed, so they are used only when enough restaurants have them (see planStartFilters). */
const SERVICE_SHARE = 0.5;

export type StartSource = 'remembered' | 'profile' | 'none';

export interface StartPlan {
  plan: RestorePlan;
  source: StartSource;
  /** the profile signature to remember when the profile was used; null otherwise */
  seededFrom: string | null;
}

/**
 * What Explore starts with, once per launch.
 *  1. If the profile's choices have changed since Explore last started from them (or never has), start from the profile: kind of place and cuisine as
 *     chosen; the ways to get food only when at least half of the matching restaurants have them. If nothing here matches, start unfiltered.
 *  2. Otherwise the person's own remembered filters, as before.
 * Choices that are no longer categories are dropped quietly.
 */
export function planStartFilters(input: {
  remembered: CategoryFilters;
  seededFrom: string;
  profile: ProfilePlacePrefs | null | undefined;
  restaurants: CategorizedRestaurant[];
  categories: RestaurantCategory[];
}): StartPlan {
  const { remembered, seededFrom, profile, restaurants, categories } = input;
  const sig = profileSignature(profile);

  if (sig !== '' && sig !== seededFrom) {
    const wanted = profileStartFilters(profile, categories);
    if (anyCategoryFilter(wanted)) {
      const withoutServices: CategoryFilters = { ...wanted, services: [] };
      const base = restaurants.filter((r) => matchesCategoryFilters(r, withoutServices));
      let filters = wanted;
      if (wanted.services.length > 0) {
        const withServices = base.filter((r) => matchesCategoryFilters(r, wanted));
        if (withServices.length < Math.ceil(base.length * SERVICE_SHARE) || withServices.length === 0) filters = withoutServices;
      }
      if (anyCategoryFilter(filters) && restaurants.some((r) => matchesCategoryFilters(r, filters))) {
        return { plan: { applied: true, reason: 'applied', filters }, source: 'profile', seededFrom: sig };
      }
    }
    // the profile's choices do not fit anything here: start unfiltered, and try again next time (the profile has not been "used" yet)
    return { plan: { applied: false, reason: 'no-matches', filters: NO_CATEGORY_FILTERS }, source: 'none', seededFrom: null };
  }

  const plan = planRestore(remembered, restaurants, categories);
  return { plan, source: plan.applied ? 'remembered' : 'none', seededFrom: null };
}

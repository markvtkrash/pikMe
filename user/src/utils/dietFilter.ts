// "Matches my diet": a chip on a restaurant's menu that hides dishes whose NAMES suggest something outside the person's dietary preferences (meat or
// fish for a vegetarian, dairy for a vegan, gluten for gluten free). It uses the same word lists as the warnings on each dish card. It is a convenience,
// not a promise: a dish name never lists everything in a dish, so a dish that stays in the list is not confirmed to fit, and the page says so.
import { getItemWarnings } from '../components/menu/menuItemWarnings';
import type { MenuItem } from '../types';

/** The diets the person set, without "none" and without anything unknown. */
export function activeDiets(restrictions: readonly string[] | null | undefined): string[] {
  return (restrictions ?? []).filter((d) => d === 'vegetarian' || d === 'vegan' || d === 'gluten_free');
}

/** True when the dish name gives no sign of conflicting with ANY of the diets. With no diet, everything passes. */
export function matchesDiet(item: Pick<MenuItem, 'name'>, diets: readonly string[]): boolean {
  if (diets.length === 0) return true;
  return getItemWarnings(item as MenuItem, [], [...diets]).restrictionWarnings.length === 0;
}

/** Does a menu chip (Fish, Chicken, Beef...) ask for something the diet rules out? True when any of the chip's words is one the diet's name check
 *  would flag. Choosing such a chip while "Matches my diet" is on could only give an empty list, so the page turns one off when the other is chosen. */
export function keywordConflictsWithDiet(keywords: readonly string[], diets: readonly string[]): boolean {
  if (diets.length === 0) return false;
  return keywords.some((k) => !matchesDiet({ name: k }, diets));
}

export const DIET_FILTER_LABEL = 'Matches my diet';

// Shown under the menu filters while the chip is on.
export const DIET_FILTER_CAPTION =
  "Hides dishes whose names suggest something outside your diet. Names don't show every ingredient, so always confirm with the restaurant staff.";

// Shown in the profile and in setup, under the diet choices, as soon as a diet is chosen.
export const DIET_PREFERENCE_NOTE =
  "Dietary preferences help us show dishes that may fit. A dish name doesn't show every ingredient or how it's made, so please always verify with the restaurant staff before you order.";

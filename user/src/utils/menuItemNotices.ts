// The notices for a menu item that is not verified by the restaurant. The compact card shows a small tag for these and the full wording in a window
// when the tag is tapped; the menu list explains the tags once at the top, so the card does not repeat three lines of text on every item.

export interface UnverifiedNotice {
  tag: string;      // the small tag on the card
  title: string;    // the window's title
  message: string;  // the full explanation
}

// null for a verified item. An item of a franchise is a typical-menu estimate; any other unverified item is an unconfirmed AI estimate.
export function unverifiedNotice(item: { isVerified?: boolean | null }, isFranchise: boolean): UnverifiedNotice | null {
  if (item.isVerified) return null;
  if (isFranchise) {
    return {
      tag: '🤖 AI-estimated',
      title: 'AI-estimated item',
      message: 'AI-estimated, based on the typical menu for this chain. Confirm ingredients and allergens with the restaurant.',
    };
  }
  return {
    tag: '⚠ Unconfirmed',
    title: 'Unconfirmed item',
    message: 'AI estimate, not verified by the restaurant. Details, including whether this dish is actually offered, may be inaccurate.',
  };
}

// One line above the menu explaining the tags, or null when every item is verified.
export function unverifiedListNote(items: { isVerified?: boolean | null }[]): string | null {
  return items.some((i) => !i.isVerified)
    ? '⚠ Unconfirmed and 🤖 AI-estimated items are estimates, not verified by the restaurant. Tap a tag for details.'
    : null;
}

// ── Ingredients are never verified from a name ────────────────────────────────────────────────────────────────────────────────────────────────
// A dish name does not list everything in a dish, so the app says on EVERY item that its ingredients are not verified. A name with no matching
// warning word is "not checked", never "fine". People who set a diet or allergen get the louder version.

export const INGREDIENT_BANNER =
  "Dish names don't show every ingredient. Confirm with the restaurant.";

export const FILTER_CAPTION = 'These filters match words in dish names only, not ingredients.';

export const AI_DISCLAIMER =
  "AI estimate from the dish name and typical recipes. It can't see the actual ingredients or how the dish is made. Confirm with the restaurant.";

// What the AI Verdict says in place of a big YES or NO: neither is a clearance for a diet or an allergen.
export const VERDICT_GOOD = 'Looks like a good fit';
export const VERDICT_NOT_GOOD = 'May not fit';

// Has the person set a diet (other than "none") or any allergen?
export function hasDietOrAllergen(profile: { allergens?: string[] | null; dietaryRestrictions?: string[] | null } | null | undefined): boolean {
  if (!profile) return false;
  const diets = (profile.dietaryRestrictions ?? []).filter((d) => d && d !== 'none');
  return diets.length > 0 || (profile.allergens ?? []).length > 0;
}

export interface IngredientCaution {
  text: string;
  strong: boolean;   // a visible tag (a diet or allergen is set) or a small quiet line
}

export function ingredientCaution(strong: boolean): IngredientCaution {
  return strong
    ? { text: 'Ingredients not verified. Confirm with the restaurant.', strong: true }
    : { text: 'Ingredients not verified', strong: false };
}

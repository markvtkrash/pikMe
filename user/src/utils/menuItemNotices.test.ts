import { unverifiedNotice, unverifiedListNote } from './menuItemNotices';

describe('unverifiedNotice', () => {
  it('has nothing to say about a verified item', () => {
    expect(unverifiedNotice({ isVerified: true }, false)).toBeNull();
    expect(unverifiedNotice({ isVerified: true }, true)).toBeNull();
  });

  it('calls an unverified franchise item AI-estimated, based on the typical menu', () => {
    const n = unverifiedNotice({ isVerified: false }, true)!;
    expect(n.tag).toContain('AI-estimated');
    expect(n.message).toMatch(/typical menu for this chain/);
    expect(n.message).toMatch(/Confirm ingredients and allergens with the restaurant/);
  });

  it('calls any other unverified item unconfirmed, and says it may not even be offered', () => {
    const n = unverifiedNotice({ isVerified: false }, false)!;
    expect(n.tag).toContain('Unconfirmed');
    expect(n.message).toMatch(/not verified by the restaurant/);
    expect(n.message).toMatch(/whether this dish is actually offered/);
  });

  it('treats a missing flag as unverified', () => {
    expect(unverifiedNotice({}, false)).not.toBeNull();
    expect(unverifiedNotice({ isVerified: null }, false)).not.toBeNull();
  });

  it('keeps the tags short enough for a small pill', () => {
    expect(unverifiedNotice({ isVerified: false }, false)!.tag.length).toBeLessThan(20);
    expect(unverifiedNotice({ isVerified: false }, true)!.tag.length).toBeLessThan(20);
  });
});

describe('unverifiedListNote', () => {
  it('explains the tags once when any item is unverified', () => {
    const note = unverifiedListNote([{ isVerified: true }, { isVerified: false }]);
    expect(note).toMatch(/Unconfirmed/);
    expect(note).toMatch(/AI-estimated/);
    expect(note).toMatch(/Tap a tag/);
  });
  it('is null when every item is verified, or the list is empty', () => {
    expect(unverifiedListNote([{ isVerified: true }, { isVerified: true }])).toBeNull();
    expect(unverifiedListNote([])).toBeNull();
  });
});

describe('ingredient caution', () => {
  const { hasDietOrAllergen, ingredientCaution, INGREDIENT_BANNER, FILTER_CAPTION, AI_DISCLAIMER, VERDICT_GOOD, VERDICT_NOT_GOOD } = require('./menuItemNotices');

  it('is loud for a person with a diet or an allergen, quiet for everyone else, and never absent', () => {
    expect(ingredientCaution(true)).toEqual({ text: 'Ingredients not verified. Confirm with the restaurant.', strong: true });
    expect(ingredientCaution(false)).toEqual({ text: 'Ingredients not verified', strong: false });
  });

  it('knows whether a profile has a diet or an allergen', () => {
    expect(hasDietOrAllergen(null)).toBe(false);
    expect(hasDietOrAllergen(undefined)).toBe(false);
    expect(hasDietOrAllergen({})).toBe(false);
    expect(hasDietOrAllergen({ allergens: [], dietaryRestrictions: [] })).toBe(false);
    expect(hasDietOrAllergen({ dietaryRestrictions: ['none'] })).toBe(false);
    expect(hasDietOrAllergen({ dietaryRestrictions: ['vegetarian'] })).toBe(true);
    expect(hasDietOrAllergen({ allergens: ['peanut'] })).toBe(true);
    expect(hasDietOrAllergen({ allergens: ['peanut'], dietaryRestrictions: ['none'] })).toBe(true);
  });

  it('says plainly that names and AI estimates do not show the ingredients', () => {
    expect(INGREDIENT_BANNER).toMatch(/Dish names don't show every ingredient/);
    expect(INGREDIENT_BANNER).toMatch(/Confirm with the restaurant/);
    expect(FILTER_CAPTION).toMatch(/dish names only, not ingredients/);
    expect(AI_DISCLAIMER).toMatch(/can't see the actual ingredients/);
    expect(AI_DISCLAIMER).toMatch(/Confirm with the restaurant/);
  });

  it('words the AI verdict as a fit, never as a yes or a no, and never as safe', () => {
    for (const text of [VERDICT_GOOD, VERDICT_NOT_GOOD, INGREDIENT_BANNER, AI_DISCLAIMER]) {
      expect(text).not.toMatch(/\b(YES|NO|safe|guarantee)\b/i);
    }
  });
});

import { getItemWarnings, getSafeIndicator } from './menuItemWarnings';
import type { MenuItem } from '../../types';

function makeItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    itemId: 'item-1',
    restaurantName: 'Test Restaurant',
    name: 'Grilled Chicken Salad',
    isVerified: false,
    nutrition: {
      calories: 300,
      totalFat_g: 10,
      saturatedFat_g: 2,
      sodium_mg: 400,
      totalCarbs_g: 15,
      dietaryFiber_g: 5,
      sugars_g: 3,
      protein_g: 35,
    },
    ...overrides,
  };
}

describe('getItemWarnings', () => {
  it('returns no warnings when the user has no allergens or restrictions', () => {
    const result = getItemWarnings(makeItem(), [], []);
    expect(result).toEqual({ allergenWarnings: [], restrictionWarnings: [] });
  });

  it('flags a matching custom allergen by keyword', () => {
    const item = makeItem({ name: 'Peanut Noodle Bowl' });
    const result = getItemWarnings(item, ['peanut'], []);
    expect(result.allergenWarnings).toEqual(['Contains: peanut']);
  });

  it('matches allergens via their keyword synonym list, not just literal substring', () => {
    const item = makeItem({ name: 'Classic Cheeseburger' });
    const result = getItemWarnings(item, ['beef'], []);
    expect(result.allergenWarnings).toEqual(['Contains: beef']);
  });

  it('falls back to a literal substring match for an allergen with no keyword list', () => {
    const item = makeItem({ name: 'Mango Smoothie' });
    const result = getItemWarnings(item, ['mango'], []);
    expect(result.allergenWarnings).toEqual(['Contains: mango']);
  });

  it('does not flag an allergen that is absent from the item name', () => {
    const item = makeItem({ name: 'Garden Salad' });
    const result = getItemWarnings(item, ['peanut'], []);
    expect(result.allergenWarnings).toEqual([]);
  });

  it('flags a vegan violation for meat', () => {
    const item = makeItem({ name: 'Grilled Chicken Salad' });
    const result = getItemWarnings(item, [], ['vegan']);
    expect(result.restrictionWarnings).toEqual(['Not vegan (contains meat)']);
  });

  it('flags a vegan violation for dairy when there is no meat', () => {
    const item = makeItem({ name: 'Cheese Pizza' });
    const result = getItemWarnings(item, [], ['vegan']);
    expect(result.restrictionWarnings).toEqual(['Contains dairy']);
  });

  it('does not double-flag dairy once a meat violation is already found for vegan', () => {
    const item = makeItem({ name: 'Chicken Alfredo with Cream Sauce' });
    const result = getItemWarnings(item, [], ['vegan']);
    expect(result.restrictionWarnings).toEqual(['Not vegan (contains meat)']);
  });

  it('flags a vegetarian violation for meat but ignores dairy', () => {
    const item = makeItem({ name: 'Cheese Pizza' });
    const result = getItemWarnings(item, [], ['vegetarian']);
    expect(result.restrictionWarnings).toEqual([]);
  });

  it('flags a gluten-free violation', () => {
    const item = makeItem({ name: 'Turkey Sandwich' });
    const result = getItemWarnings(item, [], ['gluten_free']);
    expect(result.restrictionWarnings).toEqual(['Contains gluten']);
  });

  it('combines allergen and restriction warnings independently', () => {
    const item = makeItem({ name: 'Peanut Chicken Wrap' });
    const result = getItemWarnings(item, ['peanut'], ['vegan']);
    expect(result.allergenWarnings).toEqual(['Contains: peanut']);
    expect(result.restrictionWarnings).toEqual(['Not vegan (contains meat)']);
  });
});

describe('getSafeIndicator', () => {
  it('returns true for a high score with nonzero calories', () => {
    expect(getSafeIndicator(makeItem(), 80)).toBe(true);
  });

  it('returns false for a score below the 75 threshold', () => {
    expect(getSafeIndicator(makeItem(), 74)).toBe(false);
  });

  it('returns true at exactly the 75 threshold', () => {
    expect(getSafeIndicator(makeItem(), 75)).toBe(true);
  });

  it('returns false when calories are zero regardless of score', () => {
    const item = makeItem({ nutrition: { ...makeItem().nutrition, calories: 0 } });
    expect(getSafeIndicator(item, 100)).toBe(false);
  });
});

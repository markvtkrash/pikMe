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

const warnings = (name: string, allergens: string[] = [], restrictions: string[] = []) =>
  getItemWarnings(makeItem({ name }), allergens, restrictions);

describe('getItemWarnings: wording', () => {
  it('returns no warnings when the person has no allergens or restrictions', () => {
    expect(warnings('Grilled Chicken Salad')).toEqual({ allergenWarnings: [], restrictionWarnings: [] });
  });

  it('says the NAME SUGGESTS something, never that the dish contains it, and always tells the person to ask', () => {
    const all = [
      ...warnings('Peanut Noodle Bowl', ['peanut']).allergenWarnings,
      ...warnings('Grilled Chicken Salad', [], ['vegan']).restrictionWarnings,
      ...warnings('Grilled Chicken Salad', [], ['vegetarian']).restrictionWarnings,
      ...warnings('Turkey Sandwich', [], ['gluten_free']).restrictionWarnings,
    ];
    expect(all).toHaveLength(4);
    for (const text of all) {
      expect(text).toMatch(/The name suggests/);
      expect(text).toMatch(/[Aa]sk the restaurant/);
      expect(text).not.toMatch(/Contains|contains|Not vegan \(|Not vegetarian \(/);
    }
  });
});

describe('getItemWarnings: allergens', () => {
  it('flags a matching allergen by keyword', () => {
    expect(warnings('Peanut Noodle Bowl', ['peanut']).allergenWarnings).toEqual(['The name suggests peanut. Not confirmed: ask the restaurant.']);
  });

  it('matches an allergen through its synonym list, not just the literal word', () => {
    expect(warnings('Classic Cheeseburger', ['beef']).allergenWarnings).toHaveLength(1);
  });

  it('falls back to a literal match for an allergen with no word list', () => {
    expect(warnings('Mango Smoothie', ['mango']).allergenWarnings).toHaveLength(1);
  });

  it('does not flag an allergen that the name does not suggest (the card says separately that ingredients are not verified)', () => {
    expect(warnings('Garden Salad', ['peanut']).allergenWarnings).toEqual([]);
  });

  it.each([
    ['Pad Thai', 'peanut'],
    ['Chicken Satay', 'peanut'],
    ['Caesar Salad', 'fish'],
    ['Spaghetti Carbonara', 'egg'],
    ['Teriyaki Bowl', 'soy'],
    ['Hummus Plate', 'sesame'],
    ['Pesto Pasta', 'tree nut'],
    ['Crawfish Etouffee', 'shellfish'],
    ['Alfredo Pasta', 'milk'],
    ['Birria Tacos', 'beef'],
    ['Chorizo Breakfast Burrito', 'pork'],
  ])('%s is flagged for %s', (name, allergen) => {
    expect(warnings(name, [allergen]).allergenWarnings).toHaveLength(1);
  });
});

describe('getItemWarnings: vegetarian and vegan, leaning toward over-warning', () => {
  it('flags meat for a vegetarian and a vegan', () => {
    expect(warnings('Grilled Chicken Salad', [], ['vegetarian']).restrictionWarnings).toHaveLength(1);
    expect(warnings('Grilled Chicken Salad', [], ['vegan']).restrictionWarnings).toEqual(['The name suggests meat or fish, so it may not be vegan. Ask the restaurant.']);
  });

  it('flags FISH for a vegetarian (fish is not vegetarian)', () => {
    expect(warnings('Grilled Salmon', [], ['vegetarian']).restrictionWarnings).toHaveLength(1);
    expect(warnings('Shrimp Tacos', [], ['vegetarian']).restrictionWarnings).toHaveLength(1);
  });

  it('flags dishes that often hide meat, such as stock, broth, lard and rice cooked in stock', () => {
    for (const name of ['Mexican Rice', 'Refried Beans', 'French Onion Soup', 'Chicken-free Broth Bowl', 'Chili', 'Vegetable Stew', 'Jambalaya', 'Caesar Salad']) {
      expect(warnings(name, [], ['vegetarian']).restrictionWarnings).toHaveLength(1);
    }
  });

  it('does not flag cheese for a vegetarian', () => {
    expect(warnings('Cheese Pizza', [], ['vegetarian']).restrictionWarnings).toEqual([]);
  });

  it('flags dairy and egg for a vegan when there is no meat word', () => {
    expect(warnings('Cheese Pizza', [], ['vegan']).restrictionWarnings).toEqual(['The name suggests dairy or egg, so it may not be vegan. Ask the restaurant.']);
    expect(warnings('Egg Sandwich', [], ['vegan']).restrictionWarnings).toHaveLength(1);
    expect(warnings('Honey Glazed Carrots', [], ['vegan']).restrictionWarnings).toHaveLength(1);
  });

  it('gives one warning, not two, when both meat and dairy are suggested', () => {
    expect(warnings('Chicken Alfredo with Cream Sauce', [], ['vegan']).restrictionWarnings).toHaveLength(1);
  });
});

describe('getItemWarnings: gluten free', () => {
  it('flags a gluten-free violation, including burgers, wraps, noodles and fried food', () => {
    for (const name of ['Turkey Sandwich', 'Cheeseburger', 'Chicken Wrap', 'Chicken Ramen', 'Crispy Chicken', 'Beer Battered Fish', 'Soy Glazed Salmon']) {
      expect(warnings(name, [], ['gluten_free']).restrictionWarnings).toHaveLength(1);
    }
  });

  it('does not flag a name with no gluten words', () => {
    expect(warnings('Grilled Salmon', [], ['gluten_free']).restrictionWarnings).toEqual([]);
  });
});

describe('getItemWarnings: independent warnings', () => {
  it('combines allergen and restriction warnings independently', () => {
    const result = warnings('Peanut Chicken Wrap', ['peanut'], ['vegan']);
    expect(result.allergenWarnings).toHaveLength(1);
    expect(result.restrictionWarnings).toHaveLength(1);
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

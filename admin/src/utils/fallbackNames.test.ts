import { FALLBACK_NOTE, MIN_FALLBACK_ITEMS, pickFallbackNames } from '../../../supabase/functions/get-chain-menu/chainMenuUtils';

// The dish titles from the Panera store SerpApi returned (some entries have no title).
const PANERA_HIGHLIGHTS = [
  'New Hazelnut Mocha Iced Coffee', 'Asiago Everything Bagel', 'Candy Cookie', 'Cream of Chicken & Wild Rice Soup',
  'Homestyle Chicken Noodle Soup', 'Steel Cut Oatmeal with Strawberries & Pecans', 'Cinnamon Roll',
  'Toasted Frontega Chicken', 'Mini Orange Scone 9-Pack', 'Cinnamon Swirl & Raisin Bagel', 'French Baguette',
  'Mediterranean Veggie', 'New Asiago Croissant Twists', 'Pecan Braid', 'Roasted Turkey Apple & Cheddar Sandwich',
  'Warm Bowl and Soup Mac', undefined, undefined, undefined, undefined,
];

describe('pickFallbackNames', () => {
  it('turns a real store\'s dish list into names, skipping the entries with no title', () => {
    const names = pickFallbackNames(PANERA_HIGHLIGHTS);
    expect(names).toHaveLength(16);
    expect(names).toContain('Toasted Frontega Chicken');
    expect(names).toContain('Cream of Chicken & Wild Rice Soup');
  });

  it('drops generic tags and duplicates before counting', () => {
    const names = pickFallbackNames([...PANERA_HIGHLIGHTS, 'Sauce', 'Large Drink', 'cinnamon roll', 'Cinnamon Roll']);
    expect(names).toHaveLength(16);
    expect(names.map((n) => n.toLowerCase())).not.toContain('sauce');
  });

  it('returns nothing when there are too few names to be worth a menu', () => {
    expect(pickFallbackNames(PANERA_HIGHLIGHTS.slice(0, MIN_FALLBACK_ITEMS - 1))).toEqual([]);
    expect(pickFallbackNames(['Taco', 'Burrito'])).toEqual([]);
  });

  it('accepts exactly the minimum', () => {
    const exactly = Array.from({ length: MIN_FALLBACK_ITEMS }, (_, i) => `Dish number ${i}`);
    expect(pickFallbackNames(exactly)).toHaveLength(MIN_FALLBACK_ITEMS);
  });

  it('respects the item cap', () => {
    const many = Array.from({ length: 60 }, (_, i) => `Dish number ${i}`);
    expect(pickFallbackNames(many, 20)).toHaveLength(20);
  });

  it('copes with missing or non-array input', () => {
    for (const bad of [undefined, null, 'Taco', 5, {}]) expect(pickFallbackNames(bad)).toEqual([]);
  });
});

describe('FALLBACK_NOTE', () => {
  it('says plainly that the menu came from Google\'s list', () => {
    expect(FALLBACK_NOTE).toMatch(/Google/);
    expect(FALLBACK_NOTE).toMatch(/could not be read/);
  });
});

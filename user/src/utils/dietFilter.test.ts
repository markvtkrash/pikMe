import { activeDiets, DIET_FILTER_CAPTION, DIET_FILTER_LABEL, DIET_PREFERENCE_NOTE, keywordConflictsWithDiet, matchesDiet } from './dietFilter';

const dish = (name: string) => ({ name });

describe('activeDiets', () => {
  it('keeps the real diets and drops "none"', () => {
    expect(activeDiets(['none'])).toEqual([]);
    expect(activeDiets(['vegetarian', 'none'])).toEqual(['vegetarian']);
    expect(activeDiets(['vegan', 'gluten_free'])).toEqual(['vegan', 'gluten_free']);
  });
  it('drops anything unknown, and copes with nothing', () => {
    expect(activeDiets(['halal', 'x', ''])).toEqual([]);
    expect(activeDiets(null)).toEqual([]);
    expect(activeDiets(undefined)).toEqual([]);
    expect(activeDiets([])).toEqual([]);
  });
});

describe('matchesDiet: vegetarian', () => {
  const veg = ['vegetarian'];
  it('hides dishes whose names suggest meat or fish', () => {
    for (const n of ['Chicken Wrap', 'Beef & Bean Burrito', 'Bacon Cheeseburger', 'Grilled Salmon', 'Shrimp Pad Thai', 'Chicken Caesar Salad', 'Tomato Soup', 'Pepperoni Pizza']) {
      expect(matchesDiet(dish(n), veg)).toBe(false);
    }
  });
  it('keeps dishes with no such word, including cheese and egg (fine for a vegetarian)', () => {
    for (const n of ['Cheese Pizza', 'Margherita Pizza', 'Garden Salad', 'French Fries', 'Veggie Wrap', 'Cheese Omelet']) {
      expect(matchesDiet(dish(n), veg)).toBe(true);
    }
  });
  it('is not case sensitive', () => {
    expect(matchesDiet(dish('CHICKEN WRAP'), veg)).toBe(false);
  });
});

describe('matchesDiet: vegan and gluten free', () => {
  it('vegan also hides dishes whose names suggest dairy or egg', () => {
    expect(matchesDiet(dish('Cheese Pizza'), ['vegan'])).toBe(false);
    expect(matchesDiet(dish('Cheese Omelet'), ['vegan'])).toBe(false);
    expect(matchesDiet(dish('Garden Salad'), ['vegan'])).toBe(true);
  });
  it('gluten free hides dishes whose names suggest gluten', () => {
    expect(matchesDiet(dish('Spaghetti Pasta'), ['gluten_free'])).toBe(false);
    expect(matchesDiet(dish('Grilled Chicken Sandwich'), ['gluten_free'])).toBe(false);
    expect(matchesDiet(dish('Garden Salad'), ['gluten_free'])).toBe(true);
  });
  it('with several diets a dish must pass every one', () => {
    expect(matchesDiet(dish('Garden Salad'), ['vegan', 'gluten_free'])).toBe(true);
    expect(matchesDiet(dish('Cheese Salad'), ['vegan', 'gluten_free'])).toBe(false);
    expect(matchesDiet(dish('Pasta Primavera'), ['vegetarian', 'gluten_free'])).toBe(false);
  });
});

describe('matchesDiet: no diet', () => {
  it('everything passes', () => {
    expect(matchesDiet(dish('Chicken Wrap'), [])).toBe(true);
    expect(matchesDiet(dish(''), [])).toBe(true);
  });
});

describe('the wording', () => {
  it('the chip is called "Matches my diet"', () => {
    expect(DIET_FILTER_LABEL).toBe('Matches my diet');
  });
  it('the caption says names are not ingredients and to confirm with the staff', () => {
    expect(DIET_FILTER_CAPTION).toMatch(/names/i);
    expect(DIET_FILTER_CAPTION).toMatch(/ingredient/i);
    expect(DIET_FILTER_CAPTION).toMatch(/confirm with the restaurant staff/i);
  });
  it('the profile note tells people to verify with the restaurant staff', () => {
    expect(DIET_PREFERENCE_NOTE).toMatch(/verify with the restaurant staff/i);
    expect(DIET_PREFERENCE_NOTE).toMatch(/ingredient/i);
  });
  it('neither makes a safety, health or suitability claim, and neither says "chain"', () => {
    for (const text of [DIET_FILTER_CAPTION, DIET_PREFERENCE_NOTE]) {
      const lower = text.toLowerCase();
      for (const w of ['safe', 'healthy', 'guarantee', 'chain']) expect(lower).not.toContain(w);
    }
  });
  it('the profile note says "may fit", never that a dish fits', () => {
    expect(DIET_PREFERENCE_NOTE).toMatch(/may fit/);
  });
});

// the same word lists as the chips on the menu page
const CHIPS: Record<string, string[]> = {
  Veg: ['veg', 'vegetable', 'salad', 'bean', 'lentil', 'tofu'],
  Fish: ['fish', 'salmon', 'tuna', 'cod', 'trout', 'seafood'],
  Chicken: ['chicken', 'poultry', 'wing', 'nugget'],
  Beef: ['beef', 'steak', 'burger', 'brisket', 'ribeye', 'meatball'],
  Pork: ['pork', 'bacon', 'ham', 'sausage', 'ribs', 'carnitas'],
  Ham: ['ham', 'prosciutto'],
};

describe('keywordConflictsWithDiet', () => {
  it('a vegetarian: Fish, Chicken, Beef, Pork and Ham conflict, Veg does not', () => {
    for (const name of ['Fish', 'Chicken', 'Beef', 'Pork', 'Ham']) expect(keywordConflictsWithDiet(CHIPS[name], ['vegetarian'])).toBe(true);
    expect(keywordConflictsWithDiet(CHIPS.Veg, ['vegetarian'])).toBe(false);
  });
  it('a vegan: the meat and fish chips conflict, Veg does not', () => {
    for (const name of ['Fish', 'Chicken', 'Beef', 'Pork', 'Ham']) expect(keywordConflictsWithDiet(CHIPS[name], ['vegan'])).toBe(true);
    expect(keywordConflictsWithDiet(CHIPS.Veg, ['vegan'])).toBe(false);
  });
  it('gluten free: Chicken, Fish and Veg chips do not conflict by themselves', () => {
    for (const name of ['Veg', 'Fish', 'Chicken', 'Pork', 'Ham']) expect(keywordConflictsWithDiet(CHIPS[name], ['gluten_free'])).toBe(false);
  });
  it('with no diet nothing conflicts', () => {
    for (const name of Object.keys(CHIPS)) expect(keywordConflictsWithDiet(CHIPS[name], [])).toBe(false);
  });
  it('one conflicting diet among several is enough', () => {
    expect(keywordConflictsWithDiet(CHIPS.Chicken, ['gluten_free', 'vegetarian'])).toBe(true);
  });
  it('an empty chip conflicts with nothing', () => {
    expect(keywordConflictsWithDiet([], ['vegetarian'])).toBe(false);
  });
});

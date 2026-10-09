import {
  categoriesByGroup, choiceForEditing, choiceFromGuess, cleanChoice, needsCategories, parseCategories, sameChoice, toggleKey,
  suggestDineIn, validateChoice, EMPTY_CHOICE, RestaurantCategory,
} from './categories';

const cats: RestaurantCategory[] = [
  { key: 'cafe', grp: 'venue', label: 'Cafe or coffee', sort_order: 20 },
  { key: 'restaurant', grp: 'venue', label: 'Restaurant', sort_order: 10 },
  { key: 'takeaway', grp: 'service', label: 'Takeaway', sort_order: 20 },
  { key: 'delivery', grp: 'service', label: 'Delivery', sort_order: 30 },
  { key: 'italian', grp: 'cuisine', label: 'Italian', sort_order: 10 },
];

describe('parseCategories', () => {
  it('reads valid categories and drops the rest', () => {
    const out = parseCategories([
      { key: 'cafe', grp: 'venue', label: ' Cafe ', sort_order: 2 },
      { key: '', grp: 'venue', label: 'x' },
      { key: 'a', grp: 'other', label: 'x' },
      { key: 'b', grp: 'venue', label: '  ' },
      null, 'x', 5,
    ]);
    expect(out).toEqual([{ key: 'cafe', grp: 'venue', label: 'Cafe', sort_order: 2 }]);
    for (const bad of [null, undefined, {}, 'x']) expect(parseCategories(bad)).toEqual([]);
  });
});

describe('categoriesByGroup', () => {
  it('groups and sorts by order then label', () => {
    const by = categoriesByGroup(cats);
    expect(by.venue.map((c) => c.key)).toEqual(['restaurant', 'cafe']);
    expect(by.service.map((c) => c.key)).toEqual(['takeaway', 'delivery']);
    expect(by.cuisine.map((c) => c.key)).toEqual(['italian']);
  });
});

describe('toggleKey', () => {
  it('adds and removes without changing the original', () => {
    const a = ['cafe'];
    expect(toggleKey(a, 'bar')).toEqual(['cafe', 'bar']);
    expect(toggleKey(a, 'cafe')).toEqual([]);
    expect(a).toEqual(['cafe']);
  });
});

describe('choiceFromGuess', () => {
  it('splits the rows by group, once each', () => {
    expect(choiceFromGuess([
      { key: 'cafe', grp: 'venue' }, { key: 'takeaway', grp: 'service' }, { key: 'delivery', grp: 'service' },
      { key: 'italian', grp: 'cuisine' }, { key: 'cafe', grp: 'venue' }, { key: 'x', grp: 'nope' }, null,
    ])).toEqual({ venueTypes: ['cafe'], services: ['takeaway', 'delivery'], cuisines: ['italian'] });
    expect(choiceFromGuess(null)).toEqual(EMPTY_CHOICE);
  });
});

describe('choiceForEditing (the saved choice per group, else the guess)', () => {
  const guess = { venueTypes: ['restaurant'], services: ['delivery'], cuisines: ['italian'] };

  it('uses the guess for everything the owner has not set', () => {
    expect(choiceForEditing(null, guess)).toEqual(guess);
    expect(choiceForEditing({ venue_types: null, services: null, cuisines: null }, guess)).toEqual(guess);
  });

  it('uses the owner choice for a group they set, even when it is empty', () => {
    expect(choiceForEditing({ venue_types: ['cafe'], services: [], cuisines: null }, guess))
      .toEqual({ venueTypes: ['cafe'], services: [], cuisines: ['italian'] });
  });
});

describe('cleanChoice', () => {
  it('drops keys the server does not offer and keeps the server order', () => {
    expect(cleanChoice({ venueTypes: ['cafe', 'gone', 'restaurant'], services: ['delivery', 'takeaway'], cuisines: ['nope'] }, cats))
      .toEqual({ venueTypes: ['restaurant', 'cafe'], services: ['takeaway', 'delivery'], cuisines: [] });
  });
});

describe('validateChoice and needsCategories', () => {
  it('needs at least one place type', () => {
    expect(validateChoice(EMPTY_CHOICE)).toMatch(/at least one/i);
    expect(validateChoice({ venueTypes: ['cafe'], services: [], cuisines: [] })).toBeNull();
  });

  it('nudges only a restaurant that has not chosen its place types', () => {
    expect(needsCategories({ venue_types: null })).toBe(true);
    expect(needsCategories({})).toBe(true);
    expect(needsCategories({ venue_types: ['cafe'] })).toBe(false);
    expect(needsCategories(null)).toBe(false);
  });
});

describe('sameChoice', () => {
  it('ignores order', () => {
    expect(sameChoice({ venueTypes: ['a', 'b'], services: [], cuisines: [] }, { venueTypes: ['b', 'a'], services: [], cuisines: [] })).toBe(true);
    expect(sameChoice({ venueTypes: ['a'], services: [], cuisines: [] }, { venueTypes: ['a'], services: ['x'], cuisines: [] })).toBe(false);
  });
});

describe('suggestDineIn', () => {
  const withDineIn: RestaurantCategory[] = [...cats, { key: 'dine_in', grp: 'service', label: 'Dine-in', sort_order: 10 }];

  it('adds Dine-in for a Restaurant or a Bar', () => {
    expect(suggestDineIn({ venueTypes: ['restaurant'], services: ['delivery'], cuisines: [] }, withDineIn).services).toEqual(['delivery', 'dine_in']);
    expect(suggestDineIn({ venueTypes: ['bar'], services: [], cuisines: [] }, withDineIn).services).toEqual(['dine_in']);
    expect(suggestDineIn({ venueTypes: ['cafe', 'bar'], services: [], cuisines: [] }, withDineIn).services).toEqual(['dine_in']);
  });

  it('does not guess for a cafe, bakery or other place types', () => {
    const choice = { venueTypes: ['cafe'], services: ['takeaway'], cuisines: [] };
    expect(suggestDineIn(choice, withDineIn)).toBe(choice);
    expect(suggestDineIn({ venueTypes: [], services: [], cuisines: [] }, withDineIn).services).toEqual([]);
  });

  it('leaves it alone when it is already ticked, or the server does not offer Dine-in', () => {
    const ticked = { venueTypes: ['restaurant'], services: ['dine_in'], cuisines: [] };
    expect(suggestDineIn(ticked, withDineIn)).toBe(ticked);
    const plain = { venueTypes: ['restaurant'], services: [], cuisines: [] };
    expect(suggestDineIn(plain, cats)).toBe(plain);
  });

  it('does not change the original choice', () => {
    const choice = { venueTypes: ['restaurant'], services: [] as string[], cuisines: [] };
    suggestDineIn(choice, withDineIn);
    expect(choice.services).toEqual([]);
  });
});

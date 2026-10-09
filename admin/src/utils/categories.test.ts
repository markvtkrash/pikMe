import {
  buildCategoryInput, buildRestaurantCategoryArgs, categoriesInGroup, cleanGoogleType, guessKeys, mappedTypes,
  parseAdminCategories, parseRestaurantCategories, statesFromServer, toggleKey,
} from './categories';

describe('parseAdminCategories', () => {
  it('reads categories and mappings, dropping malformed rows', () => {
    const out = parseAdminCategories({
      categories: [
        { key: 'cafe', grp: 'venue', label: 'Cafe', sort_order: 2, is_active: true, restaurants: 3 },
        { key: 'x', grp: 'bad', label: 'x' },
        null,
        { key: 'old', grp: 'cuisine', label: 'Old', is_active: false },
      ],
      mappings: [{ google_type: 'cafe', category_key: 'cafe' }, { google_type: 5 }, null],
    });
    expect(out.categories.map((c) => [c.key, c.is_active, c.restaurants])).toEqual([['cafe', true, 3], ['old', false, 0]]);
    expect(out.mappings).toEqual([{ google_type: 'cafe', category_key: 'cafe' }]);
    expect(parseAdminCategories(null)).toEqual({ categories: [], mappings: [] });
  });

  it('groups, sorts and finds mappings', () => {
    const { categories, mappings } = parseAdminCategories({
      categories: [
        { key: 'b', grp: 'venue', label: 'B', sort_order: 20 },
        { key: 'a', grp: 'venue', label: 'A', sort_order: 10 },
        { key: 'c', grp: 'service', label: 'C', sort_order: 1 },
      ],
      mappings: [{ google_type: 'z_type', category_key: 'a' }, { google_type: 'a_type', category_key: 'a' }, { google_type: 'q', category_key: 'b' }],
    });
    expect(categoriesInGroup(categories, 'venue').map((c) => c.key)).toEqual(['a', 'b']);
    expect(mappedTypes(mappings, 'a')).toEqual(['a_type', 'z_type']);
    expect(mappedTypes(mappings, 'none')).toEqual([]);
  });
});

describe('buildCategoryInput', () => {
  const ok = { key: 'Food_Truck', grp: 'venue' as const, label: ' Food truck ', sortOrder: '', isActive: true, isNew: true };

  it('cleans a good category', () => {
    expect(buildCategoryInput(ok)).toEqual({ ok: true, value: { key: 'food_truck', grp: 'venue', label: 'Food truck', sortOrder: 100, isActive: true } });
    expect(buildCategoryInput({ ...ok, sortOrder: ' 35 ' })).toMatchObject({ ok: true, value: { sortOrder: 35 } });
  });

  it('refuses a bad key, group, name or order', () => {
    expect(buildCategoryInput({ ...ok, grp: '' })).toMatchObject({ ok: false, error: expect.stringMatching(/group/i) });
    for (const key of ['', '1abc', 'Bad Key', 'x'.repeat(41), 'a-b']) {
      expect([key, buildCategoryInput({ ...ok, key }).ok]).toEqual([key, false]);
    }
    expect(buildCategoryInput({ ...ok, label: '  ' })).toMatchObject({ ok: false });
    expect(buildCategoryInput({ ...ok, label: 'x'.repeat(41) })).toMatchObject({ ok: false });
    expect(buildCategoryInput({ ...ok, sortOrder: 'first' })).toMatchObject({ ok: false });
  });
});

describe('cleanGoogleType', () => {
  it('lowercases and joins words, and refuses odd text', () => {
    expect(cleanGoogleType(' Coffee Shop ')).toBe('coffee_shop');
    expect(cleanGoogleType('italian_restaurant')).toBe('italian_restaurant');
    for (const bad of ['', '  ', '1x', 'a/b', 'drop table;']) expect([bad, cleanGoogleType(bad)]).toEqual([bad, null]);
  });
});

describe('one restaurant', () => {
  const server = parseRestaurantCategories({
    venue_types: ['cafe'], services: null, cuisines: [], google_types: ['bakery', 'meal_delivery'],
    google_guess: [{ key: 'bakery', grp: 'venue' }, { key: 'delivery', grp: 'service' }, { key: 'zzz', grp: 'nope' }],
  });

  it('reads what the server sent', () => {
    expect(server.venue_types).toEqual(['cafe']);
    expect(server.services).toBeNull();
    expect(server.cuisines).toEqual([]);
    expect(server.google_types).toEqual(['bakery', 'meal_delivery']);
    expect(guessKeys(server, 'venue')).toEqual(['bakery']);
    expect(guessKeys(server, 'service')).toEqual(['delivery']);
    expect(guessKeys(server, 'cuisine')).toEqual([]);
  });

  it('tells "not chosen" (Google guess) apart from "chosen none"', () => {
    const st = statesFromServer(server);
    expect(st.venue).toEqual({ custom: true, keys: ['cafe'] });
    expect(st.service).toEqual({ custom: false, keys: [] });
    expect(st.cuisine).toEqual({ custom: true, keys: [] });
  });

  it('sends null for a group left on Google and the list for a chosen one', () => {
    expect(buildRestaurantCategoryArgs(statesFromServer(server))).toEqual({
      ok: true, value: { venueTypes: ['cafe'], services: null, cuisines: [] },
    });
  });

  it('cannot save an empty custom place type list', () => {
    expect(buildRestaurantCategoryArgs({
      venue: { custom: true, keys: [] }, service: { custom: false, keys: [] }, cuisine: { custom: false, keys: [] },
    })).toMatchObject({ ok: false });
    expect(buildRestaurantCategoryArgs({
      venue: { custom: false, keys: [] }, service: { custom: false, keys: [] }, cuisine: { custom: false, keys: [] },
    })).toEqual({ ok: true, value: { venueTypes: null, services: null, cuisines: null } });
  });

  it('handles a missing or malformed server answer', () => {
    expect(parseRestaurantCategories(null)).toEqual({ venue_types: null, services: null, cuisines: null, google_types: [], google_guess: [] });
    expect(toggleKey(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleKey(['a'], 'a')).toEqual([]);
  });
});

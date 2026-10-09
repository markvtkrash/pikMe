import {
  anyCategoryFilter, cuisineOptions, describeCategories, hasCuisine, isCurated, labelFor, matchesCategoryFilters,
  NO_CATEGORY_FILTERS, parseCategories, serviceOptions, toggleFilter, venueOptions, CategorizedRestaurant, RestaurantCategory,
} from './categories';

const cats: RestaurantCategory[] = [
  { key: 'restaurant', grp: 'venue', label: 'Restaurant', sort_order: 10 },
  { key: 'cafe', grp: 'venue', label: 'Cafe or coffee', sort_order: 20 },
  { key: 'bar', grp: 'venue', label: 'Bar or pub', sort_order: 30 },
  { key: 'takeaway', grp: 'service', label: 'Takeaway', sort_order: 20 },
  { key: 'delivery', grp: 'service', label: 'Delivery', sort_order: 30 },
  { key: 'italian', grp: 'cuisine', label: 'Italian', sort_order: 10 },
  { key: 'mexican', grp: 'cuisine', label: 'Mexican', sort_order: 20 },
];

const r = (over: Partial<CategorizedRestaurant>): CategorizedRestaurant => ({ name: 'Place', cuisineTypes: [], ...over });

const list: CategorizedRestaurant[] = [
  r({ name: 'Moka', venueTypes: ['cafe'], services: ['takeaway', 'delivery'], cuisines: [] }),
  r({ name: 'Tap House', venueTypes: ['bar', 'restaurant'], services: ['takeaway'], cuisines: ['mexican'] }),
  r({ name: 'Luigi', venueTypes: ['restaurant'], services: [], cuisines: ['italian'] }),
];

describe('parseCategories', () => {
  it('reads valid ones only', () => {
    expect(parseCategories([{ key: 'cafe', grp: 'venue', label: ' Cafe ', sort_order: 1 }, { key: 'x', grp: 'bad', label: 'x' }, null])).toEqual([
      { key: 'cafe', grp: 'venue', label: 'Cafe', sort_order: 1 },
    ]);
    for (const bad of [null, undefined, {}, 'x']) expect(parseCategories(bad)).toEqual([]);
  });
});

describe('isCurated', () => {
  it('needs categories and restaurants that carry the new lists', () => {
    expect(isCurated(list, cats)).toBe(true);
    expect(isCurated(list, [])).toBe(false);
    expect(isCurated([r({})], cats)).toBe(false);
  });
});

describe('the chips only show categories that exist nearby, in the server order', () => {
  it('lists place types, ways to order and cuisines separately', () => {
    expect(venueOptions(list, cats).map((c) => c.key)).toEqual(['restaurant', 'cafe', 'bar']);
    expect(serviceOptions(list, cats).map((c) => c.key)).toEqual(['takeaway', 'delivery']);
    expect(cuisineOptions(list, cats).map((c) => c.key)).toEqual(['italian', 'mexican']);
  });

  it('leaves out a category nobody nearby has', () => {
    expect(venueOptions([list[0]], cats).map((c) => c.key)).toEqual(['cafe']);
    expect(serviceOptions([list[2]], cats)).toEqual([]);
  });
});

describe('matchesCategoryFilters', () => {
  it('shows everything with no filter', () => {
    expect(list.filter((x) => matchesCategoryFilters(x, NO_CATEGORY_FILTERS))).toHaveLength(3);
  });

  it('matches ANY chosen place type inside the group', () => {
    const f = { ...NO_CATEGORY_FILTERS, venues: ['cafe', 'bar'] };
    expect(list.filter((x) => matchesCategoryFilters(x, f)).map((x) => x.name)).toEqual(['Moka', 'Tap House']);
  });

  it('needs ALL chosen ways to order', () => {
    expect(list.filter((x) => matchesCategoryFilters(x, { ...NO_CATEGORY_FILTERS, services: ['takeaway'] })).map((x) => x.name)).toEqual(['Moka', 'Tap House']);
    expect(list.filter((x) => matchesCategoryFilters(x, { ...NO_CATEGORY_FILTERS, services: ['takeaway', 'delivery'] })).map((x) => x.name)).toEqual(['Moka']);
  });

  it('combines groups with AND (a cafe that delivers)', () => {
    const f = { venues: ['cafe'], services: ['delivery'], cuisines: [] };
    expect(list.filter((x) => matchesCategoryFilters(x, f)).map((x) => x.name)).toEqual(['Moka']);
    expect(list.filter((x) => matchesCategoryFilters(x, { venues: ['bar'], services: ['delivery'], cuisines: [] }))).toEqual([]);
  });

  it('a place that is a cafe AND offers both ways is found under either', () => {
    const moka = list[0];
    expect(matchesCategoryFilters(moka, { ...NO_CATEGORY_FILTERS, services: ['takeaway'] })).toBe(true);
    expect(matchesCategoryFilters(moka, { ...NO_CATEGORY_FILTERS, services: ['delivery'] })).toBe(true);
  });
});

describe('hasCuisine', () => {
  it("uses the server's list", () => {
    expect(hasCuisine(r({ cuisines: ['italian'] }), 'italian')).toBe(true);
    expect(hasCuisine(r({ cuisines: ['italian'] }), 'mexican')).toBe(false);
  });

  it('still finds an unclaimed place by Google type or name when the server found no cuisine', () => {
    expect(hasCuisine(r({ name: 'Pizza Palace', cuisines: [] }), 'italian')).toBe(true);
    expect(hasCuisine(r({ name: 'X', cuisineTypes: ['mexican_restaurant'], cuisines: [] }), 'mexican')).toBe(true);
  });

  it('respects an owner who chose their cuisines, even when the name suggests another', () => {
    expect(hasCuisine(r({ name: 'Pizza Palace', cuisines: [], ownerCategories: true }), 'italian')).toBe(false);
  });

  it('does not match a key that has no earlier filter', () => {
    expect(hasCuisine(r({ name: 'Pizza Palace' }), 'brewery')).toBe(false);
  });
});

describe('small helpers', () => {
  it('toggles a filter without changing the original', () => {
    const a = ['cafe'];
    expect(toggleFilter(a, 'bar')).toEqual(['cafe', 'bar']);
    expect(toggleFilter(a, 'cafe')).toEqual([]);
    expect(a).toEqual(['cafe']);
  });

  it('knows when a filter is active', () => {
    expect(anyCategoryFilter(NO_CATEGORY_FILTERS)).toBe(false);
    expect(anyCategoryFilter({ ...NO_CATEGORY_FILTERS, services: ['takeaway'] })).toBe(true);
  });

  it('labels a key, with a tidy fallback for one the app does not know', () => {
    expect(labelFor(cats, 'cafe')).toBe('Cafe or coffee');
    expect(labelFor(cats, 'food_truck')).toBe('Food Truck');
  });

  it('describes a restaurant for its card, or gives null for an older server', () => {
    expect(describeCategories(list[1], cats)).toBe('Bar or pub · Restaurant');
    expect(describeCategories(list[1], cats, 3)).toBe('Bar or pub · Restaurant · Mexican');
    expect(describeCategories(r({ venueTypes: [], cuisines: [] }), cats)).toBeNull();
    expect(describeCategories(r({}), cats)).toBeNull();
    expect(describeCategories(list[0], [])).toBeNull();
  });
});

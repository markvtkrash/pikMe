import { NO_CATEGORY_FILTERS, type CategorizedRestaurant, type RestaurantCategory } from './categories';
import { keepKnownKeys, planRestore, readyToRestore, sanitizeFilters } from './rememberedFilters';

const cat = (key: string, grp: RestaurantCategory['grp']): RestaurantCategory => ({ key, grp, label: key, sort_order: 0 });
const CATEGORIES = [cat('cafe', 'venue'), cat('bar', 'venue'), cat('takeout', 'service'), cat('delivery', 'service'), cat('thai', 'cuisine'), cat('italian', 'cuisine')];

const r = (name: string, venueTypes: string[], services: string[], cuisines: string[]): CategorizedRestaurant =>
  ({ name, cuisineTypes: [], venueTypes, services, cuisines });
const RESTAURANTS = [
  r('Bean House', ['cafe'], ['takeout'], []),
  r('Thai Spot', [], ['takeout', 'delivery'], ['thai']),
  r('Pasta Place', [], [], ['italian']),
];

describe('sanitizeFilters', () => {
  it('keeps three lists of strings', () => {
    expect(sanitizeFilters({ venues: ['cafe'], services: ['takeout'], cuisines: ['thai'] })).toEqual({ venues: ['cafe'], services: ['takeout'], cuisines: ['thai'] });
  });
  it('drops anything that is not a non-empty string, and repeats', () => {
    expect(sanitizeFilters({ venues: ['cafe', 'cafe', '', 5, null, { a: 1 }], services: 'x', cuisines: undefined }))
      .toEqual({ venues: ['cafe'], services: [], cuisines: [] });
  });
  it('gives no filters for junk', () => {
    for (const v of [null, undefined, 'x', 5, [], true]) expect(sanitizeFilters(v)).toEqual(NO_CATEGORY_FILTERS);
  });
  it('caps each list at 30', () => {
    const many = Array.from({ length: 50 }, (_, i) => `k${i}`);
    expect(sanitizeFilters({ venues: many, services: [], cuisines: [] }).venues).toHaveLength(30);
  });
});

describe('keepKnownKeys', () => {
  it('drops choices that are no longer in the category list, group by group', () => {
    expect(keepKnownKeys({ venues: ['cafe', 'gone'], services: ['takeout', 'gone2'], cuisines: ['thai', 'gone3'] }, CATEGORIES))
      .toEqual({ venues: ['cafe'], services: ['takeout'], cuisines: ['thai'] });
  });
  it('a key under the wrong group is dropped', () => {
    expect(keepKnownKeys({ venues: ['thai'], services: [], cuisines: [] }, CATEGORIES).venues).toEqual([]);
  });
  it('keeps everything when the list has not arrived yet', () => {
    const f = { venues: ['cafe'], services: [], cuisines: ['thai'] };
    expect(keepKnownKeys(f, [])).toEqual(f);
  });
});

describe('planRestore', () => {
  it('uses the remembered filters when restaurants here match them', () => {
    const plan = planRestore({ venues: [], services: [], cuisines: ['thai'] }, RESTAURANTS, CATEGORIES);
    expect(plan).toEqual({ applied: true, reason: 'applied', filters: { venues: [], services: [], cuisines: ['thai'] } });
  });
  it('starts unfiltered when nothing was remembered', () => {
    expect(planRestore(NO_CATEGORY_FILTERS, RESTAURANTS, CATEGORIES)).toEqual({ applied: false, reason: 'nothing-saved', filters: NO_CATEGORY_FILTERS });
  });
  it('starts unfiltered when no restaurant here matches (a list that opens empty looks broken)', () => {
    const plan = planRestore({ venues: ['bar'], services: [], cuisines: [] }, RESTAURANTS, CATEGORIES);
    expect(plan).toEqual({ applied: false, reason: 'no-matches', filters: NO_CATEGORY_FILTERS });
  });
  it('applies the groups together the way the filter sheet does', () => {
    expect(planRestore({ venues: [], services: ['takeout', 'delivery'], cuisines: ['thai'] }, RESTAURANTS, CATEGORIES).applied).toBe(true);
    expect(planRestore({ venues: ['cafe'], services: [], cuisines: ['thai'] }, RESTAURANTS, CATEGORIES).applied).toBe(false);
  });
  it('ignores choices an admin has removed, and applies what is left', () => {
    const plan = planRestore({ venues: [], services: [], cuisines: ['thai', 'removed'] }, RESTAURANTS, CATEGORIES);
    expect(plan.filters.cuisines).toEqual(['thai']);
    expect(plan.applied).toBe(true);
  });
  it('is not applied when only removed choices were remembered', () => {
    expect(planRestore({ venues: [], services: [], cuisines: ['removed'] }, RESTAURANTS, CATEGORIES).reason).toBe('nothing-saved');
  });
  it('copes with junk stored, and with no restaurants', () => {
    expect(planRestore({ venues: 5, services: null, cuisines: ['thai'] } as any, RESTAURANTS, CATEGORIES).applied).toBe(true);
    expect(planRestore({ venues: [], services: [], cuisines: ['thai'] }, [], CATEGORIES).reason).toBe('no-matches');
  });
});

describe('readyToRestore', () => {
  const base = { hydrated: true, restaurantCount: 5, alreadyDecided: false, currentlyFiltered: false };
  it('is ready once the stored choice is read and restaurants are in', () => {
    expect(readyToRestore(base)).toBe(true);
  });
  it('waits for the stored choice to be read', () => {
    expect(readyToRestore({ ...base, hydrated: false })).toBe(false);
  });
  it('waits for restaurants', () => {
    expect(readyToRestore({ ...base, restaurantCount: 0 })).toBe(false);
  });
  it('decides only once per launch', () => {
    expect(readyToRestore({ ...base, alreadyDecided: true })).toBe(false);
  });
  it('never overwrites filters the person has already chosen', () => {
    expect(readyToRestore({ ...base, currentlyFiltered: true })).toBe(false);
  });
});

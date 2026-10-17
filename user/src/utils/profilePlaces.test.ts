import { NO_CATEGORY_FILTERS, type CategorizedRestaurant, type RestaurantCategory } from './categories';
import { categoryChoices, choiceLabels, planStartFilters, profileSignature, profileStartFilters } from './profilePlaces';

const cat = (key: string, grp: RestaurantCategory['grp'], label: string, sort_order = 0): RestaurantCategory => ({ key, grp, label, sort_order });
const CATEGORIES = [
  cat('bakery', 'venue', 'Bakery', 40), cat('cafe', 'venue', 'Cafe or coffee', 20), cat('bar', 'venue', 'Bar or pub', 30),
  cat('takeaway', 'service', 'Takeaway', 20), cat('delivery', 'service', 'Delivery', 30),
  cat('thai', 'cuisine', 'Thai', 60), cat('italian', 'cuisine', 'Italian', 10), cat('asian', 'cuisine', 'Asian', 70),
];

const r = (name: string, venueTypes: string[], services: string[], cuisines: string[]): CategorizedRestaurant =>
  ({ name, cuisineTypes: [], venueTypes, services, cuisines });

describe('categoryChoices', () => {
  it("lists one group's categories in the admin's order, with their labels", () => {
    expect(categoryChoices(CATEGORIES, 'venue')).toEqual([
      { value: 'cafe', label: 'Cafe or coffee' }, { value: 'bar', label: 'Bar or pub' }, { value: 'bakery', label: 'Bakery' },
    ]);
    expect(categoryChoices(CATEGORIES, 'cuisine').map((c) => c.value)).toEqual(['italian', 'thai', 'asian']);
  });
  it('is empty for no categories', () => {
    expect(categoryChoices([], 'venue')).toEqual([]);
  });
  it('does not change the list it was given', () => {
    const copy = [...CATEGORIES];
    categoryChoices(CATEGORIES, 'venue');
    expect(CATEGORIES).toEqual(copy);
  });
});

describe('choiceLabels', () => {
  it('shows the labels of the chosen keys, in the admin order', () => {
    expect(choiceLabels(['thai', 'italian'], CATEGORIES, 'cuisine')).toEqual(['Italian', 'Thai']);
  });
  it('leaves out a key that is no longer a category of that group', () => {
    expect(choiceLabels(['thai', 'gone', 'cafe'], CATEGORIES, 'cuisine')).toEqual(['Thai']);
  });
  it('copes with nothing chosen', () => {
    expect(choiceLabels(null, CATEGORIES, 'venue')).toEqual([]);
    expect(choiceLabels([], CATEGORIES, 'venue')).toEqual([]);
  });
});

describe('profileStartFilters', () => {
  it('turns the profile choices into filters', () => {
    expect(profileStartFilters({ venuePreferences: ['cafe'], servicePreferences: ['takeaway'], cuisinePreferences: ['thai'] }, CATEGORIES))
      .toEqual({ venues: ['cafe'], services: ['takeaway'], cuisines: ['thai'] });
  });
  it('drops keys that are not categories of the right group', () => {
    expect(profileStartFilters({ venuePreferences: ['cafe', 'thai'], servicePreferences: ['bar'], cuisinePreferences: ['korean'] }, CATEGORIES))
      .toEqual({ venues: ['cafe'], services: [], cuisines: [] });
  });
  it('uses nothing without a category list, or without a profile', () => {
    expect(profileStartFilters({ cuisinePreferences: ['thai'] }, [])).toEqual(NO_CATEGORY_FILTERS);
    expect(profileStartFilters(null, CATEGORIES)).toEqual(NO_CATEGORY_FILTERS);
    expect(profileStartFilters(undefined, CATEGORIES)).toEqual(NO_CATEGORY_FILTERS);
  });
  it('copes with junk in the lists', () => {
    expect(profileStartFilters({ cuisinePreferences: ['thai', 5, null, ''] as any }, CATEGORIES).cuisines).toEqual(['thai']);
  });
});

describe('profileSignature', () => {
  it('is empty when nothing is chosen', () => {
    expect(profileSignature(null)).toBe('');
    expect(profileSignature({})).toBe('');
    expect(profileSignature({ venuePreferences: [], servicePreferences: [], cuisinePreferences: [] })).toBe('');
  });
  it('is the same for the same choices in any order, and for repeats', () => {
    expect(profileSignature({ cuisinePreferences: ['thai', 'italian'] })).toBe(profileSignature({ cuisinePreferences: ['italian', 'thai', 'thai'] }));
  });
  it('changes when any group changes', () => {
    const base = profileSignature({ cuisinePreferences: ['thai'] });
    expect(profileSignature({ cuisinePreferences: ['thai', 'asian'] })).not.toBe(base);
    expect(profileSignature({ cuisinePreferences: ['thai'], venuePreferences: ['cafe'] })).not.toBe(base);
    expect(profileSignature({ cuisinePreferences: ['thai'], servicePreferences: ['takeaway'] })).not.toBe(base);
  });
  it('a key moved to another group is a different choice', () => {
    expect(profileSignature({ venuePreferences: ['cafe'] })).not.toBe(profileSignature({ servicePreferences: ['cafe'] }));
  });
});

describe('planStartFilters', () => {
  const RESTAURANTS = [
    r('Bean House', ['cafe'], ['takeaway'], []),
    r('Thai Spot', [], ['takeaway', 'delivery'], ['thai']),
    r('Thai Two', [], [], ['thai']),
    r('Pasta Place', [], [], ['italian']),
  ];
  const plan = (o: Partial<Parameters<typeof planStartFilters>[0]> = {}) =>
    planStartFilters({ remembered: NO_CATEGORY_FILTERS, seededFrom: '', profile: null, restaurants: RESTAURANTS, categories: CATEGORIES, ...o });

  it('starts from the profile the first time (nothing was ever started from it)', () => {
    const p = plan({ profile: { cuisinePreferences: ['thai'] } });
    expect(p.source).toBe('profile');
    expect(p.plan).toEqual({ applied: true, reason: 'applied', filters: { venues: [], services: [], cuisines: ['thai'] } });
    expect(p.seededFrom).toBe(profileSignature({ cuisinePreferences: ['thai'] }));
  });
  it('starts from the profile again after the profile was edited, over the remembered filters', () => {
    const old = profileSignature({ cuisinePreferences: ['italian'] });
    const p = plan({ profile: { cuisinePreferences: ['thai'] }, seededFrom: old, remembered: { venues: [], services: [], cuisines: ['italian'] } });
    expect(p.source).toBe('profile');
    expect(p.plan.filters.cuisines).toEqual(['thai']);
  });
  it('keeps the remembered filters when the profile has not changed since', () => {
    const sig = profileSignature({ cuisinePreferences: ['thai'] });
    const p = plan({ profile: { cuisinePreferences: ['thai'] }, seededFrom: sig, remembered: { venues: [], services: [], cuisines: ['italian'] } });
    expect(p.source).toBe('remembered');
    expect(p.plan.filters.cuisines).toEqual(['italian']);
    expect(p.seededFrom).toBeNull();
  });
  it('with no profile choices, uses the remembered filters', () => {
    const p = plan({ profile: {}, remembered: { venues: [], services: [], cuisines: ['italian'] } });
    expect(p.source).toBe('remembered');
  });
  it('with neither, starts unfiltered', () => {
    const p = plan();
    expect(p.source).toBe('none');
    expect(p.plan.applied).toBe(false);
    expect(p.plan.filters).toEqual(NO_CATEGORY_FILTERS);
  });
  it('starts unfiltered, and does not mark the profile as used, when nothing here matches it', () => {
    const p = plan({ profile: { venuePreferences: ['bar'] } });
    expect(p.plan.applied).toBe(false);
    expect(p.seededFrom).toBeNull();
  });
  it('drops profile choices an admin has removed, and uses the rest', () => {
    const p = plan({ profile: { cuisinePreferences: ['thai', 'removed'] } });
    expect(p.plan.filters.cuisines).toEqual(['thai']);
  });
  it('kind of place and cuisine together must both fit', () => {
    expect(plan({ profile: { venuePreferences: ['cafe'], cuisinePreferences: ['thai'] } }).plan.applied).toBe(false);
  });

  describe('ways to get the food are patchy, so they are used only when enough restaurants have them', () => {
    it('uses them when at least half of the matching restaurants offer them', () => {
      // two Thai places, one offers takeaway and delivery: 1 of 2 is half
      const p = plan({ profile: { cuisinePreferences: ['thai'], servicePreferences: ['takeaway'] } });
      expect(p.plan.filters).toEqual({ venues: [], services: ['takeaway'], cuisines: ['thai'] });
    });
    it('leaves them out when fewer than half offer them, keeping the rest', () => {
      const many = [r('A', [], ['delivery'], ['thai']), r('B', [], [], ['thai']), r('C', [], [], ['thai']), r('D', [], [], ['thai'])];
      const p = plan({ restaurants: many, profile: { cuisinePreferences: ['thai'], servicePreferences: ['delivery'] } });
      expect(p.plan.filters).toEqual({ venues: [], services: [], cuisines: ['thai'] });
      expect(p.plan.applied).toBe(true);
    });
    it('leaves them out when none offers them', () => {
      const p = plan({ profile: { cuisinePreferences: ['italian'], servicePreferences: ['delivery'] } });
      expect(p.plan.filters).toEqual({ venues: [], services: [], cuisines: ['italian'] });
    });
    it('a profile that is ONLY ways to get food, and almost none offer them, starts unfiltered', () => {
      const p = plan({ profile: { servicePreferences: ['delivery'] } });
      expect(p.plan.applied).toBe(false);
    });
    it('every chosen way must be offered (takeaway and delivery together)', () => {
      const p = plan({ profile: { cuisinePreferences: ['thai'], servicePreferences: ['takeaway', 'delivery'] } });
      expect(p.plan.filters.services).toEqual(['takeaway', 'delivery']);
    });
  });

  it('copes with no restaurants', () => {
    const p = plan({ restaurants: [], profile: { cuisinePreferences: ['thai'] } });
    expect(p.plan.applied).toBe(false);
  });
});

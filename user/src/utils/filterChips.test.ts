import { activeChips, filtersButtonLabel, removeChip, showResultsLabel, splitChips } from './filterChips';
import { NO_CATEGORY_FILTERS, RestaurantCategory } from './categories';

const cats: RestaurantCategory[] = [
  { key: 'cafe', grp: 'venue', label: 'Cafe or coffee', sort_order: 1 },
  { key: 'bar', grp: 'venue', label: 'Bar or pub', sort_order: 2 },
  { key: 'takeaway', grp: 'service', label: 'Takeaway', sort_order: 1 },
  { key: 'italian', grp: 'cuisine', label: 'Italian', sort_order: 1 },
];

describe('activeChips', () => {
  it('is empty with no filter', () => {
    expect(activeChips(NO_CATEGORY_FILTERS, cats, null)).toEqual([]);
  });

  it('has one chip per chosen filter, in the order of the sheet', () => {
    const chips = activeChips({ venues: ['bar', 'cafe'], services: ['takeaway'], cuisines: ['italian'] }, cats, null);
    expect(chips.map((c) => [c.kind, c.label])).toEqual([
      ['venue', 'Bar or pub'], ['venue', 'Cafe or coffee'], ['service', 'Takeaway'], ['cuisine', 'Italian'],
    ]);
    expect(new Set(chips.map((c) => c.id)).size).toBe(4);
  });

  it('labels a key the app does not know in a tidy way', () => {
    expect(activeChips({ ...NO_CATEGORY_FILTERS, venues: ['food_truck'] }, cats, null)[0].label).toBe('Food Truck');
  });

  it('includes the earlier single-choice filters when they are used', () => {
    const chips = activeChips(NO_CATEGORY_FILTERS, [], { type: 'cafe', cuisine: 'Mexican', typeLabel: (t) => `Type ${t}` });
    expect(chips.map((c) => [c.kind, c.label])).toEqual([['legacyType', 'Type cafe'], ['legacyCuisine', 'Mexican']]);
    expect(activeChips(NO_CATEGORY_FILTERS, [], { type: null, cuisine: null, typeLabel: (t) => t })).toEqual([]);
  });
});

describe('removeChip', () => {
  const filters = { venues: ['cafe', 'bar'], services: ['takeaway'], cuisines: ['italian'] };
  const chips = activeChips(filters, cats, null);

  it('removes just that choice and leaves the rest', () => {
    expect(removeChip(filters, chips[0])).toEqual({ venues: ['bar'], services: ['takeaway'], cuisines: ['italian'] });
    expect(removeChip(filters, chips[2])).toEqual({ venues: ['cafe', 'bar'], services: [], cuisines: ['italian'] });
    expect(removeChip(filters, chips[3])).toEqual({ venues: ['cafe', 'bar'], services: ['takeaway'], cuisines: [] });
  });

  it('does not change the original, and leaves the filters alone for an earlier-style chip', () => {
    removeChip(filters, chips[0]);
    expect(filters.venues).toEqual(['cafe', 'bar']);
    expect(removeChip(filters, { id: 'x', label: 'x', kind: 'legacyType', key: 'cafe' })).toBe(filters);
  });
});

describe('splitChips', () => {
  const many = activeChips({ venues: ['a', 'b', 'c'], services: ['d', 'e'], cuisines: ['f'] }, [], null);

  it('shows the first few and counts the rest', () => {
    const { shown, more } = splitChips(many, 4);
    expect(shown).toHaveLength(4);
    expect(more).toBe(2);
  });

  it('shows all when they fit', () => {
    expect(splitChips(many.slice(0, 3), 4)).toEqual({ shown: many.slice(0, 3), more: 0 });
    expect(splitChips([], 4)).toEqual({ shown: [], more: 0 });
  });
});

describe('labels', () => {
  it('words the Filters button with the count', () => {
    expect(filtersButtonLabel(0)).toBe('Filters');
    expect(filtersButtonLabel(3)).toBe('Filters (3)');
  });

  it('words the sheet button with the number of places', () => {
    expect(showResultsLabel(12)).toBe('Show 12 places');
    expect(showResultsLabel(1)).toBe('Show 1 place');
    expect(showResultsLabel(0)).toBe('No places match');
  });
});

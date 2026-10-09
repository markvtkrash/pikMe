const rpc = jest.fn();
const maybeSingle = jest.fn();
const single = jest.fn();
const updateArgs = jest.fn();
jest.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle(table) }) }),
      update: (values: unknown) => {
        updateArgs(table, values);
        return { eq: () => ({ select: () => ({ single: () => single() }) }) };
      },
    }),
  },
}));

import { getGoogleGuess, getRestaurantCategories, getStoredGoogleTypes, saveRestaurantCategories } from './categories';

beforeEach(() => {
  rpc.mockReset(); maybeSingle.mockReset(); single.mockReset(); updateArgs.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('getRestaurantCategories', () => {
  it('asks for the active categories and keeps the well-formed ones', async () => {
    rpc.mockResolvedValue({ data: [{ key: 'cafe', grp: 'venue', label: 'Cafe', sort_order: 1 }, { key: 'x', grp: 'bad', label: 'x' }], error: null });
    await expect(getRestaurantCategories()).resolves.toEqual([{ key: 'cafe', grp: 'venue', label: 'Cafe', sort_order: 1 }]);
    expect(rpc).toHaveBeenCalledWith('get_restaurant_categories');
  });

  it('throws when the lookup fails, so the screen can say so', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getRestaurantCategories()).rejects.toEqual({ message: 'boom' });
  });
});

describe('getGoogleGuess', () => {
  it('turns the rows into a choice', async () => {
    rpc.mockResolvedValue({ data: [{ key: 'cafe', grp: 'venue' }, { key: 'delivery', grp: 'service' }], error: null });
    await expect(getGoogleGuess(['cafe', 'meal_delivery'])).resolves.toEqual({ venueTypes: ['cafe'], services: ['delivery'], cuisines: [] });
    expect(rpc).toHaveBeenCalledWith('categorize_google_types', { p_types: ['cafe', 'meal_delivery'] });
  });

  it('gives an empty guess when the lookup fails, so claiming is never blocked', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getGoogleGuess(['cafe'])).resolves.toEqual({ venueTypes: [], services: [], cuisines: [] });
  });
});

describe('getStoredGoogleTypes', () => {
  it('returns the stored text types, or none', async () => {
    maybeSingle.mockResolvedValue({ data: { cuisine_types: ['cafe', 5, 'bakery'] }, error: null });
    await expect(getStoredGoogleTypes('ChIJ_x')).resolves.toEqual(['cafe', 'bakery']);
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getStoredGoogleTypes('ChIJ_x')).resolves.toEqual([]);
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getStoredGoogleTypes('ChIJ_x')).resolves.toEqual([]);
  });
});

describe('saveRestaurantCategories', () => {
  it('saves the three lists on the restaurant row', async () => {
    single.mockResolvedValue({ data: { venue_types: ['cafe'], services: [], cuisines: [] }, error: null });
    await expect(saveRestaurantCategories('r1', { venueTypes: ['cafe'], services: [], cuisines: [] }))
      .resolves.toEqual({ venue_types: ['cafe'], services: [], cuisines: [] });
    expect(updateArgs).toHaveBeenCalledWith('restaurants', expect.objectContaining({ venue_types: ['cafe'], services: [], cuisines: [] }));
  });

  it('throws the database message when it refuses (for example an unknown category)', async () => {
    single.mockResolvedValue({ data: null, error: { message: 'Unknown place type: x' } });
    await expect(saveRestaurantCategories('r1', { venueTypes: ['x'], services: [], cuisines: [] })).rejects.toEqual({ message: 'Unknown place type: x' });
  });
});

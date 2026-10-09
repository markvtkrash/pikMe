jest.mock('./supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

import { supabase } from './supabase';
import { CHAIN_MENU_MESSAGE, getChainMenuItems, getMenuItemsForOwnerView, isChainRestaurant } from './chainMenu';

const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isChainRestaurant', () => {
  it('asks the franchise lookup with the trimmed name and returns true for a chain', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(isChainRestaurant('  Taco Bell  ')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('is_franchise_chain', { p_name: 'Taco Bell' });
  });

  it('returns false for an independent restaurant', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(isChainRestaurant("Joe's Diner")).resolves.toBe(false);
  });

  it('returns false (not locked out) when the lookup fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(isChainRestaurant('Taco Bell')).resolves.toBe(false);
    warn.mockRestore();
  });

  it('only treats an explicit true as a chain', async () => {
    for (const data of [null, undefined, 'true', 1, {}]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(isChainRestaurant('X')).resolves.toBe(false);
    }
  });

  it('does not call the database for an empty name', async () => {
    for (const name of ['', '   ', undefined as unknown as string, null as unknown as string]) {
      await expect(isChainRestaurant(name)).resolves.toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('CHAIN_MENU_MESSAGE', () => {
  it('tells the owner what happened and what to do', () => {
    expect(CHAIN_MENU_MESSAGE).toMatch(/chain/);
    expect(CHAIN_MENU_MESSAGE).toMatch(/managed centrally/);
    expect(CHAIN_MENU_MESSAGE).toMatch(/support/);
  });
});

// from('menu_items').select('*').ilike(...).order(...) resolves to { data, error }
function mockNameLookup(rows: any[]) {
  from.mockReturnValue({
    select: () => ({ ilike: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
  });
}

describe('getChainMenuItems', () => {
  it('asks the customer lookup with the place and the trimmed name, and sorts by name', async () => {
    rpc.mockResolvedValue({
      data: [
        { item_id: 'chain_b', name: 'Nachos', calories: 440, protein_g: 9, is_verified: false },
        { item_id: 'chain_a', name: 'Bean Burrito', calories: null, protein_g: null, is_verified: true, is_out_of_stock: false },
      ],
      error: null,
    });
    const items = await getChainMenuItems('  7 Brew  ', 'ChIJabcdefghij');
    expect(rpc).toHaveBeenCalledWith('get_menu_items_for_restaurant', { p_place_id: 'ChIJabcdefghij', p_restaurant_name: '7 Brew' });
    expect(items.map((i) => i.name)).toEqual(['Bean Burrito', 'Nachos']);
    expect(items[0]).toMatchObject({ id: 'chain_a', item_id: 'chain_a', calories: null, is_verified: true });
  });

  it('sends no place when there is none, and returns an empty list for no rows', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getChainMenuItems('7 Brew', undefined)).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith('get_menu_items_for_restaurant', { p_place_id: null, p_restaurant_name: '7 Brew' });
  });

  it('throws the database error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getChainMenuItems('7 Brew', 'p')).rejects.toEqual({ message: 'boom' });
  });
});

describe('getMenuItemsForOwnerView', () => {
  it('shows a chain owner the chain menu customers see', async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'is_franchise_chain'
          ? { data: true, error: null }
          : { data: [{ item_id: 'chain_a', name: 'Crunchy Taco', is_verified: false }], error: null },
      ),
    );
    const items = await getMenuItemsForOwnerView({ name: 'Taco Bell', google_place_id: 'ChIJabcdefghij' });
    expect(items.map((i) => i.name)).toEqual(['Crunchy Taco']);
    expect(from).not.toHaveBeenCalled();
  });

  it('shows everyone else their own items exactly as before (the plain name lookup)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    mockNameLookup([{ item_id: 'x1', place_id: 'ChIJzzzzzzzzzz', name: 'House Special', calories: 500, protein_g: 20, is_verified: true, is_out_of_stock: true }]);
    const items = await getMenuItemsForOwnerView({ name: "Joe's Diner", google_place_id: 'ChIJzzzzzzzzzz' });
    expect(items).toEqual([
      { id: 'x1', item_id: 'x1', name: 'House Special', calories: 500, protein_g: 20, is_verified: true, is_out_of_stock: true },
    ]);
    expect(rpc).not.toHaveBeenCalledWith('get_menu_items_for_restaurant', expect.anything());
  });

  it('shows an independent with no items of its own an empty menu, never the old shared list', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    mockNameLookup([
      { item_id: 'old1', place_id: null, name: 'Old Shared Dish', calories: 1, protein_g: 1, is_verified: false, is_out_of_stock: false },
      { item_id: 'elsewhere1', place_id: 'ChIJother00000', name: 'Other Branch Dish', calories: 1, protein_g: 1, is_verified: true, is_out_of_stock: false },
    ]);
    const items = await getMenuItemsForOwnerView({ name: "Joe's Diner", google_place_id: 'ChIJzzzzzzzzzz' });
    expect(items).toEqual([]);
  });

  it('falls back to the name lookup if the chain lookup fails, instead of showing nothing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(fn === 'is_franchise_chain' ? { data: true, error: null } : { data: null, error: { message: 'function not found' } }),
    );
    mockNameLookup([{ item_id: 'y1', name: 'Fallback Dish', calories: 1, protein_g: 1, is_verified: false, is_out_of_stock: false }]);
    const items = await getMenuItemsForOwnerView({ name: 'Taco Bell', google_place_id: 'p' });
    expect(items.map((i) => i.name)).toEqual(['Fallback Dish']);
    warn.mockRestore();
  });
});

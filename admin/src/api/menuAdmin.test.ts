jest.mock('./supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

import { supabase } from './supabase';
import {
  getRestaurantMenu,
  getRestaurantsWithMenuCounts,
  getRestaurantMenuForEdit,
  getMenuSharingInfo,
  saveMenuItem,
  previewDeleteMenuItems,
  deleteMenuItems,
  SaveMenuItemInput,
} from './menuAdmin';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getRestaurantMenu', () => {
  it('asks for the menu by restaurant name and returns the rows', async () => {
    rpc.mockResolvedValue({ data: [{ item_id: 'a' }], error: null });
    await expect(getRestaurantMenu('Taco Bell')).resolves.toEqual([{ item_id: 'a' }]);
    expect(rpc).toHaveBeenCalledWith('admin_get_restaurant_menu', { p_restaurant_name: 'Taco Bell' });
  });

  it('returns [] for null data and throws on error', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getRestaurantMenu('X')).resolves.toEqual([]);
    rpc.mockResolvedValue({ data: null, error: { message: 'admin only' } });
    await expect(getRestaurantMenu('X')).rejects.toEqual({ message: 'admin only' });
  });
});

describe('getRestaurantsWithMenuCounts (paged)', () => {
  function pagedRpc(pages: any[][]) {
    const range = jest.fn();
    pages.forEach((rows) => range.mockResolvedValueOnce({ data: rows, error: null }));
    rpc.mockReturnValue({ range });
    return range;
  }
  const rows = (n: number, prefix = 'r') => Array.from({ length: n }, (_, i) => ({ restaurant_name: `${prefix}${i}` }));

  it('returns a single short page without asking for more', async () => {
    const range = pagedRpc([rows(3)]);
    const result = await getRestaurantsWithMenuCounts();
    expect(result).toHaveLength(3);
    expect(rpc).toHaveBeenCalledWith('admin_list_restaurants_with_menu_counts');
    expect(range).toHaveBeenCalledTimes(1);
    expect(range).toHaveBeenCalledWith(0, 999);
  });

  it('keeps fetching while pages come back full (1000 rows), then stops', async () => {
    const range = pagedRpc([rows(1000, 'a'), rows(1000, 'b'), rows(5, 'c')]);
    const result = await getRestaurantsWithMenuCounts();
    expect(result).toHaveLength(2005);
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(range).toHaveBeenNthCalledWith(3, 2000, 2999);
  });

  it('handles an empty result', async () => {
    pagedRpc([[]]);
    await expect(getRestaurantsWithMenuCounts()).resolves.toEqual([]);
  });

  it('throws if a page fails', async () => {
    const range = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    rpc.mockReturnValue({ range });
    await expect(getRestaurantsWithMenuCounts()).rejects.toEqual({ message: 'boom' });
  });
});

describe('getRestaurantMenuForEdit', () => {
  it('requests the editable menu by name', async () => {
    rpc.mockResolvedValue({ data: [{ item_id: 'a', dietary_fiber_g: 3 }], error: null });
    await expect(getRestaurantMenuForEdit('Taco Bell')).resolves.toEqual([{ item_id: 'a', dietary_fiber_g: 3 }]);
    expect(rpc).toHaveBeenCalledWith('admin_get_restaurant_menu_for_edit', { p_restaurant_name: 'Taco Bell' });
  });

  it('returns [] for null data and throws on error', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getRestaurantMenuForEdit('X')).resolves.toEqual([]);
    rpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(getRestaurantMenuForEdit('X')).rejects.toEqual({ message: 'nope' });
  });
});

describe('getMenuSharingInfo', () => {
  it('reads the first row and coerces counts to numbers', async () => {
    rpc.mockResolvedValue({ data: [{ cached_locations: '12', claimed_locations: 1 }], error: null });
    await expect(getMenuSharingInfo('Taco Bell')).resolves.toEqual({ cached_locations: 12, claimed_locations: 1 });
    expect(rpc).toHaveBeenCalledWith('admin_menu_sharing_info', { p_restaurant_name: 'Taco Bell' });
  });

  it('accepts a single object instead of an array', async () => {
    rpc.mockResolvedValue({ data: { cached_locations: 2, claimed_locations: 0 }, error: null });
    await expect(getMenuSharingInfo('X')).resolves.toEqual({ cached_locations: 2, claimed_locations: 0 });
  });

  it('falls back to zeros when nothing is returned', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getMenuSharingInfo('X')).resolves.toEqual({ cached_locations: 0, claimed_locations: 0 });
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMenuSharingInfo('X')).resolves.toEqual({ cached_locations: 0, claimed_locations: 0 });
  });

  it('throws on error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'admin only' } });
    await expect(getMenuSharingInfo('X')).rejects.toEqual({ message: 'admin only' });
  });
});

describe('saveMenuItem', () => {
  const input: SaveMenuItemInput = {
    restaurantName: 'Taco Bell',
    name: 'Crunchy Taco',
    calories: 170,
    protein_g: 8,
    total_carbs_g: 13,
    total_fat_g: 9,
    saturated_fat_g: 3.5,
    sodium_mg: 310,
    dietary_fiber_g: 3,
    sugars_g: 1,
    serving_weight_grams: 78,
    is_verified: false,
    is_out_of_stock: false,
  };

  it('creates: sends every field as a p_ param with a null item id', async () => {
    rpc.mockResolvedValue({ data: { itemId: 'admin_x', created: true }, error: null });

    await expect(saveMenuItem(input)).resolves.toEqual({ itemId: 'admin_x', created: true });

    expect(rpc).toHaveBeenCalledWith('admin_save_menu_item', {
      p_restaurant_name: 'Taco Bell',
      p_item_id: null,
      p_name: 'Crunchy Taco',
      p_calories: 170,
      p_protein_g: 8,
      p_total_carbs_g: 13,
      p_total_fat_g: 9,
      p_saturated_fat_g: 3.5,
      p_sodium_mg: 310,
      p_dietary_fiber_g: 3,
      p_sugars_g: 1,
      p_serving_weight_grams: 78,
      p_is_verified: false,
      p_is_out_of_stock: false,
    });
  });

  it('updates: passes the existing item id', async () => {
    rpc.mockResolvedValue({ data: { itemId: 'i9', created: false }, error: null });

    await saveMenuItem({ ...input, itemId: 'i9', is_verified: true });

    expect(rpc).toHaveBeenCalledWith(
      'admin_save_menu_item',
      expect.objectContaining({ p_item_id: 'i9', p_is_verified: true })
    );
  });

  it('passes a missing serving size as null', async () => {
    rpc.mockResolvedValue({ data: { itemId: 'x', created: true }, error: null });
    await saveMenuItem({ ...input, serving_weight_grams: null });
    expect(rpc).toHaveBeenCalledWith('admin_save_menu_item', expect.objectContaining({ p_serving_weight_grams: null }));
  });

  it('surfaces database errors (duplicate name, not an admin, ...)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'An item named "X" already exists for this restaurant' } });
    await expect(saveMenuItem(input)).rejects.toEqual({
      message: 'An item named "X" already exists for this restaurant',
    });
  });
});

describe('previewDeleteMenuItems / deleteMenuItems', () => {
  it('preview is a dry run and returns the counts', async () => {
    rpc.mockResolvedValue({ data: { items: 3, coupons: 1, savedCopies: 7, deleted: false }, error: null });

    await expect(previewDeleteMenuItems(['a', 'b', 'c'])).resolves.toEqual({
      items: 3,
      coupons: 1,
      savedCopies: 7,
      deleted: false,
    });
    expect(rpc).toHaveBeenCalledWith('admin_delete_menu_items', { p_item_ids: ['a', 'b', 'c'], p_dry_run: true });
  });

  it('delete is NOT a dry run', async () => {
    rpc.mockResolvedValue({ data: { items: 2, coupons: 0, savedCopies: 0, deleted: true }, error: null });

    const result = await deleteMenuItems(['a', 'b']);

    expect(result.deleted).toBe(true);
    expect(rpc).toHaveBeenCalledWith('admin_delete_menu_items', { p_item_ids: ['a', 'b'], p_dry_run: false });
  });

  it('both surface errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Delete at most 500 items at a time' } });
    await expect(previewDeleteMenuItems(['a'])).rejects.toEqual({ message: 'Delete at most 500 items at a time' });
    await expect(deleteMenuItems(['a'])).rejects.toEqual({ message: 'Delete at most 500 items at a time' });
  });
});

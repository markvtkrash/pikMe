jest.mock('./supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { supabase } from './supabase';
import { mapMenuRow, fetchStoredMenuItems } from './menuItems';

const from = supabase.from as jest.Mock;
const rpc = supabase.rpc as jest.Mock;

const row = {
  item_id: 'ai_abc',
  restaurant_name: 'Taco Bell',
  name: 'Crunchy Taco',
  calories: 170,
  total_fat_g: 9,
  saturated_fat_g: 3.5,
  sodium_mg: 310,
  total_carbs_g: 13,
  dietary_fiber_g: 3,
  sugars_g: 1,
  protein_g: 8,
  serving_weight_grams: 78,
  image_url: 'https://img/x.jpg',
  is_verified: true,
  nutrition_source: 'owner_provided',
};

// Query-builder stub for the legacy name lookup:
// from('menu_items').select('*').eq('restaurant_name', n).eq('is_out_of_stock', false)
function legacyBuilder(result: any) {
  const builder: any = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest
    .fn()
    .mockImplementationOnce(() => builder)
    .mockImplementationOnce(() => Promise.resolve(result));
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('mapMenuRow', () => {
  it('maps every DB column to the MenuItem shape', () => {
    expect(mapMenuRow(row)).toEqual({
      itemId: 'ai_abc',
      name: 'Crunchy Taco',
      restaurantName: 'Taco Bell',
      nutrition: {
        calories: 170,
        totalFat_g: 9,
        saturatedFat_g: 3.5,
        sodium_mg: 310,
        totalCarbs_g: 13,
        dietaryFiber_g: 3,
        sugars_g: 1,
        protein_g: 8,
        servingWeightGrams: 78,
      },
      imageUrl: 'https://img/x.jpg',
      isVerified: true,
      nutritionSource: 'owner_provided',
    });
  });

  it('defaults missing fiber and sugar to 0', () => {
    const mapped = mapMenuRow({ ...row, dietary_fiber_g: null, sugars_g: undefined });
    expect(mapped.nutrition.dietaryFiber_g).toBe(0);
    expect(mapped.nutrition.sugars_g).toBe(0);
  });

  it('passes through an unverified AI-estimate row', () => {
    const mapped = mapMenuRow({ ...row, is_verified: false, nutrition_source: 'ai_estimate' });
    expect(mapped.isVerified).toBe(false);
    expect(mapped.nutritionSource).toBe('ai_estimate');
  });
});

describe('fetchStoredMenuItems', () => {
  const restaurant = { placeId: 'place_1', name: 'Taco Bell' };

  it('asks the database function for the location menu using BOTH place id and name', async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    await fetchStoredMenuItems(restaurant);
    expect(rpc).toHaveBeenCalledWith('get_menu_items_for_restaurant', {
      p_place_id: 'place_1',
      p_restaurant_name: 'Taco Bell',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('returns the mapped rows from the function', async () => {
    rpc.mockResolvedValue({ data: [row, { ...row, item_id: 'ai_def', name: 'Burrito' }], error: null });
    const items = await fetchStoredMenuItems(restaurant);
    expect(items.map((i) => i.itemId)).toEqual(['ai_abc', 'ai_def']);
    expect(items[0].nutrition.calories).toBe(170);
  });

  it('returns [] (so the caller can use the AI pull) when nothing is stored', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(fetchStoredMenuItems(restaurant)).resolves.toEqual([]);
  });

  it('treats null data as nothing stored', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchStoredMenuItems(restaurant)).resolves.toEqual([]);
  });

  describe('when the database function is unavailable (migration 067 not applied)', () => {
    it('falls back to the original name lookup, excluding out-of-stock items', async () => {
      rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
      const builder = legacyBuilder({ data: [row], error: null });
      from.mockReturnValue(builder);

      const items = await fetchStoredMenuItems(restaurant);

      expect(from).toHaveBeenCalledWith('menu_items');
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.eq).toHaveBeenNthCalledWith(1, 'restaurant_name', 'Taco Bell');
      expect(builder.eq).toHaveBeenNthCalledWith(2, 'is_out_of_stock', false);
      expect(items.map((i) => i.itemId)).toEqual(['ai_abc']);
    });

    it('returns [] when the fallback finds nothing', async () => {
      rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
      from.mockReturnValue(legacyBuilder({ data: [], error: null }));
      await expect(fetchStoredMenuItems(restaurant)).resolves.toEqual([]);
    });

    it('returns [] instead of throwing when both lookups fail', async () => {
      rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
      from.mockReturnValue(legacyBuilder({ data: null, error: { message: 'also boom' } }));
      await expect(fetchStoredMenuItems(restaurant)).resolves.toEqual([]);
    });
  });
});

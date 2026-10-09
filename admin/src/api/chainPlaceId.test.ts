jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('./reports', () => ({ fetchAllPages: jest.fn() }));

import { supabase } from './supabase';
import { setChainPlaceId } from './chainMenus';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('setChainPlaceId', () => {
  it('sends the chain, the trimmed place ID and the picked store name', async () => {
    rpc.mockResolvedValue({ data: { saved: true, removed: false, warning: null }, error: null });
    const result = await setChainPlaceId('c1', '  ChIJabcdefghij  ', ' 7 Brew Coffee ');
    expect(rpc).toHaveBeenCalledWith('admin_set_chain_place_id', {
      p_chain_id: 'c1', p_place_id: 'ChIJabcdefghij', p_store_name: '7 Brew Coffee',
    });
    expect(result).toEqual({ saved: true, removed: false, warning: null });
  });

  it('sends no store name when none was picked, and a blank place ID to remove', async () => {
    rpc.mockResolvedValue({ data: { saved: true, removed: true, warning: null }, error: null });
    const result = await setChainPlaceId('c1', '   ');
    expect(rpc).toHaveBeenCalledWith('admin_set_chain_place_id', { p_chain_id: 'c1', p_place_id: '', p_store_name: null });
    expect(result.removed).toBe(true);
  });

  it('passes on the warning when the store does not match the chain', async () => {
    rpc.mockResolvedValue({ data: { saved: true, removed: false, warning: 'Google lists this store as "X"' }, error: null });
    await expect(setChainPlaceId('c1', 'ChIJabcdefghij')).resolves.toMatchObject({ warning: 'Google lists this store as "X"' });
  });

  it('throws the database error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'That does not look like a Google place ID' } });
    await expect(setChainPlaceId('c1', 'bad')).rejects.toEqual({ message: 'That does not look like a Google place ID' });
  });
});

jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('./reports', () => ({ fetchAllPages: jest.fn() }));

import { supabase } from './supabase';
import { addFranchiseChain } from './chainMenus';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('addFranchiseChain', () => {
  it('sends trimmed values, and null for blank optional fields', async () => {
    rpc.mockResolvedValue({ data: 'new-id', error: null });
    await expect(addFranchiseChain({ name: '  Taco Bell ', category: '  ', menuUrl: '' })).resolves.toBe('new-id');
    expect(rpc).toHaveBeenCalledWith('admin_add_franchise_chain', {
      p_name: 'Taco Bell', p_category: null, p_aliases: [], p_menu_url: null,
    });
  });

  it('sends the category, aliases and menu page when given', async () => {
    rpc.mockResolvedValue({ data: 'id2', error: null });
    await addFranchiseChain({ name: 'Jinkies', category: ' Pizza ', aliases: ['Jinkies Pizza'], menuUrl: ' https://j.com/menu ' });
    expect(rpc).toHaveBeenCalledWith('admin_add_franchise_chain', {
      p_name: 'Jinkies', p_category: 'Pizza', p_aliases: ['Jinkies Pizza'], p_menu_url: 'https://j.com/menu',
    });
  });

  it('throws the database message, for example a duplicate', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'This name or one of its aliases is already used by "Taco Bell" on the franchise list' } });
    await expect(addFranchiseChain({ name: 'taco bell #5' })).rejects.toEqual({
      message: 'This name or one of its aliases is already used by "Taco Bell" on the franchise list',
    });
  });
});

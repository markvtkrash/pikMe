jest.mock('./supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));
jest.mock('./reports', () => ({
  fetchAllPages: jest.fn(),
}));

import { supabase } from './supabase';
import { setChainBuiltInMenuUrl } from './chainMenus';
import { validateMenuLinkInput } from '../utils/chainMenuSources';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('setChainBuiltInMenuUrl', () => {
  it('sends the chain and the trimmed address', async () => {
    rpc.mockResolvedValue({ error: null });
    await setChainBuiltInMenuUrl('c1', '  https://whataburger.com/menu  ');
    expect(rpc).toHaveBeenCalledWith('admin_set_chain_menu_url', { p_chain_id: 'c1', p_url: 'https://whataburger.com/menu' });
  });

  it('sends a blank value to clear it', async () => {
    rpc.mockResolvedValue({ error: null });
    await setChainBuiltInMenuUrl('c1', '   ');
    expect(rpc).toHaveBeenCalledWith('admin_set_chain_menu_url', { p_chain_id: 'c1', p_url: '' });
  });

  it('throws the database error (for example a rejected address or a non-admin)', async () => {
    rpc.mockResolvedValue({ error: { message: 'The menu page must be a full web address' } });
    await expect(setChainBuiltInMenuUrl('c1', 'nope')).rejects.toEqual({ message: 'The menu page must be a full web address' });
  });
});

describe('the form check used for the built-in page', () => {
  it('accepts a normal address and a blank (which clears it)', () => {
    expect(validateMenuLinkInput('https://www.whataburger.com/menu', '')).toBeNull();
    expect(validateMenuLinkInput('', '')).toBeNull();
  });

  it('rejects things that are not a full web address', () => {
    expect(validateMenuLinkInput('whataburger.com/menu', '')).toMatch(/web address/);
    expect(validateMenuLinkInput('https://x.com/a b', '')).toMatch(/spaces/);
  });
});

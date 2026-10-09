jest.mock('./supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));
jest.mock('./reports', () => ({
  fetchAllPages: jest.fn(),
}));

import { supabase } from './supabase';
import { fetchAllPages } from './reports';
import { clearChainMenuLink, getChainMenuSources, markChainMenuStale, setChainMenuLink } from './chainMenus';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getChainMenuSources', () => {
  it('pages through the admin list function', async () => {
    (fetchAllPages as jest.Mock).mockResolvedValue([{ chain_id: 'a' }]);
    await expect(getChainMenuSources()).resolves.toEqual([{ chain_id: 'a' }]);
    expect(fetchAllPages).toHaveBeenCalledWith('admin_list_chain_menu_sources');
  });
});

describe('setChainMenuLink', () => {
  it('sends the trimmed link and store parameter', async () => {
    rpc.mockResolvedValue({ error: null });
    await setChainMenuLink('c1', '  https://www.tacobell.com/food  ', ' store=034416 ');
    expect(rpc).toHaveBeenCalledWith('admin_set_chain_menu_link', {
      p_chain_id: 'c1', p_menu_link: 'https://www.tacobell.com/food', p_store_ref: 'store=034416',
    });
  });

  it('sends null for a missing or blank store parameter', async () => {
    rpc.mockResolvedValue({ error: null });
    await setChainMenuLink('c1', 'https://x.com/menu');
    await setChainMenuLink('c1', 'https://x.com/menu', '   ');
    expect(rpc.mock.calls[0][1].p_store_ref).toBeNull();
    expect(rpc.mock.calls[1][1].p_store_ref).toBeNull();
  });

  it('throws the database error (for example a rejected link)', async () => {
    rpc.mockResolvedValue({ error: { message: 'Menu link must be a full web address' } });
    await expect(setChainMenuLink('c1', 'nope')).rejects.toEqual({ message: 'Menu link must be a full web address' });
  });
});

describe('clearChainMenuLink', () => {
  it('sends a blank link, which the database treats as "back to SerpApi"', async () => {
    rpc.mockResolvedValue({ error: null });
    await clearChainMenuLink('c1');
    expect(rpc).toHaveBeenCalledWith('admin_set_chain_menu_link', { p_chain_id: 'c1', p_menu_link: '', p_store_ref: null });
  });
});

describe('markChainMenuStale', () => {
  it('returns whether a lookup existed to mark', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(markChainMenuStale('c1')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('admin_mark_chain_menu_stale', { p_chain_id: 'c1' });
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(markChainMenuStale('c1')).resolves.toBe(false);
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(markChainMenuStale('c1')).resolves.toBe(false);
  });

  it('throws on a database error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'admin only' } });
    await expect(markChainMenuStale('c1')).rejects.toEqual({ message: 'admin only' });
  });
});

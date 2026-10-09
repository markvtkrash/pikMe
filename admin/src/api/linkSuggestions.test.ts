jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('./reports', () => ({ fetchAllPages: jest.fn() }));

import { supabase } from './supabase';
import {
  approveChainLinkSuggestion, dismissChainLinkSuggestion, getChainLinkSuggestions, replaceChainLinkSuggestion,
} from './chainMenus';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('getChainLinkSuggestions', () => {
  it('returns the rows with the owner count as a number', async () => {
    rpc.mockResolvedValue({ data: [{ chain_id: 'c1', chain_name: 'Taco Bell', suggested_link: 'https://t.com/menu', owner_count: '2' }], error: null });
    const rows = await getChainLinkSuggestions();
    expect(rpc).toHaveBeenCalledWith('admin_list_chain_link_suggestions');
    expect(rows[0].owner_count).toBe(2);
  });

  it('returns an empty list when there is nothing', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getChainLinkSuggestions()).resolves.toEqual([]);
  });

  it('throws the database error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not admin' } });
    await expect(getChainLinkSuggestions()).rejects.toEqual({ message: 'not admin' });
  });
});

describe('approveChainLinkSuggestion / dismissChainLinkSuggestion', () => {
  it('send the chain and the link', async () => {
    rpc.mockResolvedValue({ error: null });
    await approveChainLinkSuggestion('c1', 'https://t.com/menu');
    expect(rpc).toHaveBeenCalledWith('admin_approve_chain_link_suggestion', { p_chain_id: 'c1', p_link: 'https://t.com/menu' });
    await dismissChainLinkSuggestion('c1', 'https://t.com/menu');
    expect(rpc).toHaveBeenCalledWith('admin_dismiss_chain_link_suggestion', { p_chain_id: 'c1', p_link: 'https://t.com/menu' });
  });

  it('throw when the chain already has a page', async () => {
    rpc.mockResolvedValue({ error: { message: 'This chain already has a built-in menu page' } });
    await expect(approveChainLinkSuggestion('c1', 'https://t.com/menu')).rejects.toEqual({
      message: 'This chain already has a built-in menu page',
    });
  });
});

describe('replaceChainLinkSuggestion', () => {
  it('sends the chain, the new link and the page the admin saw', async () => {
    rpc.mockResolvedValue({ error: null });
    await replaceChainLinkSuggestion('c1', 'https://new.com/menu', 'https://old.com/menu');
    expect(rpc).toHaveBeenCalledWith('admin_replace_chain_link_suggestion', {
      p_chain_id: 'c1', p_link: 'https://new.com/menu', p_expected_current: 'https://old.com/menu',
    });
  });

  it('throws when the page changed since the admin opened the list', async () => {
    const message = "The chain's built-in menu page changed since you opened this list. Reload and check again";
    rpc.mockResolvedValue({ error: { message } });
    await expect(replaceChainLinkSuggestion('c1', 'https://new.com/menu', 'https://old.com/menu')).rejects.toEqual({ message });
  });
});

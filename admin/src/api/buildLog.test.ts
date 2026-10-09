jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('./reports', () => ({ fetchAllPages: jest.fn() }));

import { supabase } from './supabase';
import { getChainBuildLog } from './chainMenus';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('getChainBuildLog', () => {
  it('asks for the hours and returns rows with the item count as a number', async () => {
    rpc.mockResolvedValue({ data: [{ chain_id: 'c1', chain_name: 'Taco Bell', outcome: 'ok', item_count: '12' }], error: null });
    const rows = await getChainBuildLog(24);
    expect(rpc).toHaveBeenCalledWith('admin_list_chain_build_log', { p_hours: 24 });
    expect(rows[0].item_count).toBe(12);
  });

  it('returns an empty list when nothing was built', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getChainBuildLog(6)).resolves.toEqual([]);
  });

  it('throws the database error (for example a missing migration)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function not found' } });
    await expect(getChainBuildLog(24)).rejects.toEqual({ message: 'function not found' });
  });
});

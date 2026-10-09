jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('./reports', () => ({ fetchAllPages: jest.fn() }));

import { supabase } from './supabase';
import { getChainBuildStatus, runChainBuildsNow, setChainBuildsPerRun } from './chainMenus';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('getChainBuildStatus', () => {
  it('returns the single status row with numbers and a list normalised', async () => {
    rpc.mockResolvedValue({
      data: [{ cron_installed: true, per_run: 3, queued_count: '7', queued_names: null, places_waiting: '4', places_attention: '2' }],
      error: null,
    });
    const s = await getChainBuildStatus();
    expect(rpc).toHaveBeenCalledWith('admin_chain_build_status');
    expect(s.queued_count).toBe(7);
    expect(s.queued_names).toEqual([]);
    expect(s.places_waiting).toBe(4);
    expect(s.places_attention).toBe(2);
  });

  it('throws the database error (for example a non-admin or a missing migration)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not admin' } });
    await expect(getChainBuildStatus()).rejects.toEqual({ message: 'not admin' });
  });

  it('throws when nothing comes back', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getChainBuildStatus()).rejects.toThrow('No status returned');
  });
});

describe('setChainBuildsPerRun', () => {
  it('sends the number, 0 meaning paused', async () => {
    rpc.mockResolvedValue({ error: null });
    await setChainBuildsPerRun(0);
    expect(rpc).toHaveBeenCalledWith('admin_set_chain_builds_per_run', { p_per_run: 0 });
  });

  it('throws a rejected value', async () => {
    rpc.mockResolvedValue({ error: { message: 'Builds per run must be a whole number' } });
    await expect(setChainBuildsPerRun(99)).rejects.toEqual({ message: 'Builds per run must be a whole number' });
  });
});

describe('runChainBuildsNow', () => {
  it('resolves to how many chains were started', async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    await expect(runChainBuildsNow()).resolves.toBe(3);
    expect(rpc).toHaveBeenCalledWith('admin_run_chain_builds_now');
  });

  it('resolves to 0 when the server returns nothing usable', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(runChainBuildsNow()).resolves.toBe(0);
  });

  it('throws the database error', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } });
    await expect(runChainBuildsNow()).rejects.toEqual({ message: 'boom' });
  });
});

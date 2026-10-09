jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('./reports', () => ({ fetchAllPages: jest.fn() }));

import { supabase } from './supabase';
import { runMenuQueueNow, runPlaceQueueNow, setPlaceBuildsPerDay, setPlaceBuildsPerRun } from './chainMenus';
import { describePlaceRun, describeQueueRun } from '../utils/chainMenuSources';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('runMenuQueueNow', () => {
  it('starts the queue and returns how many restaurants and chains were started', async () => {
    rpc.mockResolvedValue({ data: { chains: 1, places: '3' }, error: null });
    await expect(runMenuQueueNow()).resolves.toEqual({ chains: 1, places: 3 });
    expect(rpc).toHaveBeenCalledWith('admin_run_menu_queue_now');
  });

  it('returns zeros when the server answers with nothing', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(runMenuQueueNow()).resolves.toEqual({ chains: 0, places: 0 });
  });

  it('throws the database error (for example a non-admin or a missing migration)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not admin' } });
    await expect(runMenuQueueNow()).rejects.toEqual({ message: 'not admin' });
  });
});

describe('describeQueueRun', () => {
  it('names what was started, with singular and plural', () => {
    expect(describeQueueRun({ places: 1, chains: 0 })).toMatch(/^1 restaurant are being built/);
    expect(describeQueueRun({ places: 3, chains: 2 })).toMatch(/^3 restaurants and 2 franchises are being built/);
    expect(describeQueueRun({ places: 0, chains: 1 })).toMatch(/^1 franchise are being built/);
  });

  it('explains why nothing started', () => {
    expect(describeQueueRun({ places: 0, chains: 0 })).toMatch(/Nothing is due/);
  });
});

describe('the independent-restaurant limits', () => {
  it('sends the per-run limit and the daily cap', async () => {
    rpc.mockResolvedValue({ error: null });
    await setPlaceBuildsPerRun(5);
    expect(rpc).toHaveBeenCalledWith('admin_set_place_builds_per_run', { p_per_run: 5 });
    await setPlaceBuildsPerDay(100);
    expect(rpc).toHaveBeenCalledWith('admin_set_place_builds_per_day', { p_per_day: 100 });
  });

  it('throws a rejected value', async () => {
    rpc.mockResolvedValue({ error: { message: 'The daily cap must be a whole number from 0 (paused) to 1000' } });
    await expect(setPlaceBuildsPerDay(5000)).rejects.toEqual({ message: 'The daily cap must be a whole number from 0 (paused) to 1000' });
  });
});

describe('runPlaceQueueNow / describePlaceRun', () => {
  it('starts the restaurant queue and returns how many were started', async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    await expect(runPlaceQueueNow()).resolves.toBe(3);
    expect(rpc).toHaveBeenCalledWith('admin_run_place_queue_now');
  });

  it('returns 0 when the server returns nothing usable, and throws the database error', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(runPlaceQueueNow()).resolves.toBe(0);
    rpc.mockResolvedValue({ data: null, error: { message: 'not admin' } });
    await expect(runPlaceQueueNow()).rejects.toEqual({ message: 'not admin' });
  });

  it('tells the admin what started, or why nothing did', () => {
    expect(describePlaceRun(1)).toMatch(/^1 restaurant is being built/);
    expect(describePlaceRun(4)).toMatch(/^4 restaurants are being built/);
    expect(describePlaceRun(0)).toMatch(/No restaurant is due/);
  });
});

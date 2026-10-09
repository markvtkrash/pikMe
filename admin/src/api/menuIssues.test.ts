jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));

import { supabase } from './supabase';
import { getPlaceMenuIssues, requeuePlaceBuild, setPlaceOverrideLink } from './menuIssues';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('getPlaceMenuIssues', () => {
  it('returns the rows with the numbers as numbers', async () => {
    rpc.mockResolvedValue({
      data: [{ job_id: '5', restaurant_name: 'Jalapenos', status: 'needs_attention', attempts: '3', requested_count: '12', claimed: true }],
      error: null,
    });
    const rows = await getPlaceMenuIssues();
    expect(rpc).toHaveBeenCalledWith('admin_list_place_menu_issues');
    expect(rows[0]).toMatchObject({ job_id: 5, attempts: 3, requested_count: 12, claimed: true });
  });

  it('returns an empty list for nothing, and throws the database error', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getPlaceMenuIssues()).resolves.toEqual([]);
    rpc.mockResolvedValue({ data: null, error: { message: 'not admin' } });
    await expect(getPlaceMenuIssues()).rejects.toEqual({ message: 'not admin' });
  });
});

describe('setPlaceOverrideLink / requeuePlaceBuild', () => {
  it('sends the job and the trimmed link, or a blank one to remove it', async () => {
    rpc.mockResolvedValue({ error: null });
    await setPlaceOverrideLink(5, '  https://example.com/menu  ');
    expect(rpc).toHaveBeenCalledWith('admin_set_place_override_link', { p_job_id: 5, p_link: 'https://example.com/menu' });
    await setPlaceOverrideLink(5, '   ');
    expect(rpc).toHaveBeenCalledWith('admin_set_place_override_link', { p_job_id: 5, p_link: '' });
  });

  it('retries a job, and throws the database error', async () => {
    rpc.mockResolvedValue({ error: null });
    await requeuePlaceBuild(9);
    expect(rpc).toHaveBeenCalledWith('admin_requeue_place_build', { p_job_id: 9 });
    rpc.mockResolvedValue({ error: { message: 'Restaurant menu job not found' } });
    await expect(requeuePlaceBuild(9)).rejects.toEqual({ message: 'Restaurant menu job not found' });
    await expect(setPlaceOverrideLink(9, 'x')).rejects.toEqual({ message: 'Restaurant menu job not found' });
  });
});

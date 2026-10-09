const rpc = jest.fn();
jest.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { getOwnerAnnouncements } from './announcements';

beforeEach(() => {
  rpc.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('getOwnerAnnouncements', () => {
  it('asks for the owner audience and returns the announcements', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 'a1', title: 'Hello', message: 'Owners: new report', kind: 'info', link_label: 'See it', link_url: 'https://example.com/r' }],
      error: null,
    });
    const out = await getOwnerAnnouncements();
    expect(rpc).toHaveBeenCalledWith('get_active_announcements', { p_audience: 'owner' });
    expect(out).toEqual([
      { id: 'a1', title: 'Hello', message: 'Owners: new report', kind: 'info', linkLabel: 'See it', linkUrl: 'https://example.com/r' },
    ]);
  });

  it('gives none when there is nothing, or the lookup fails', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getOwnerAnnouncements()).resolves.toEqual([]);
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    await expect(getOwnerAnnouncements()).resolves.toEqual([]);
  });

  it('drops malformed rows and unsafe links', async () => {
    rpc.mockResolvedValue({
      data: [
        { id: 'x', title: '', message: 'm', kind: 'info' },
        { id: 'y', title: 'T', message: 'M', kind: 'info', link_label: 'Go', link_url: 'javascript:alert(1)' },
      ],
      error: null,
    });
    const out = await getOwnerAnnouncements();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'y', linkUrl: null, linkLabel: null });
  });
});

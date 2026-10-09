const rpc = jest.fn();
jest.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { dismissMenuImportAlert, getMenuImportAlert, getMenuLinkHelp } from './menuImport';

beforeEach(() => {
  rpc.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('getMenuImportAlert', () => {
  const row = (alert_status: string, alert_link: unknown = 'https://x.example.com/menu') => ({ alert_status, alert_link, alert_finished_at: '2026-10-08T03:00:00Z' });

  it('asks the owner-only function and returns the alert for an empty or unreadable read', async () => {
    rpc.mockResolvedValue({ data: [row('no_items')], error: null });
    await expect(getMenuImportAlert()).resolves.toEqual({ status: 'no_items', link: 'https://x.example.com/menu' });
    expect(rpc).toHaveBeenCalledWith('owner_menu_import_alert');

    rpc.mockResolvedValue({ data: [row('needs_attention')], error: null });
    await expect(getMenuImportAlert()).resolves.toEqual({ status: 'needs_attention', link: 'https://x.example.com/menu' });
  });

  it('accepts a single object as well as a list', async () => {
    rpc.mockResolvedValue({ data: row('no_items'), error: null });
    await expect(getMenuImportAlert()).resolves.toEqual({ status: 'no_items', link: 'https://x.example.com/menu' });
  });

  it('is null when there is nothing to show', async () => {
    for (const data of [[], null, undefined]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(getMenuImportAlert()).resolves.toBeNull();
    }
  });

  it('ignores any other status or a missing link, so it never shows a half-formed alert', async () => {
    for (const bad of [row('done'), row('pending'), row('error'), row('no_items', ''), row('no_items', null), row('no_items', 5)]) {
      rpc.mockResolvedValue({ data: [bad], error: null });
      await expect(getMenuImportAlert()).resolves.toBeNull();
    }
  });

  it('is null (and does not throw) when the lookup fails, for example before the migration is applied', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function not found' } });
    await expect(getMenuImportAlert()).resolves.toBeNull();
  });
});

describe('dismissMenuImportAlert', () => {
  it('calls the owner-only dismiss function', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(dismissMenuImportAlert()).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('owner_dismiss_menu_import_alert');
  });

  it('throws when it fails, so the bar is not hidden for nothing', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(dismissMenuImportAlert()).rejects.toEqual({ message: 'nope' });
  });
});

describe('getMenuLinkHelp', () => {
  it('asks the owner-only function and returns the suggested link', async () => {
    rpc.mockResolvedValue({ data: [{ suggested_link: ' https://good.example.com/menu ', owner_link_failed: true }], error: null });
    await expect(getMenuLinkHelp()).resolves.toEqual({ suggestedLink: 'https://good.example.com/menu', ownerLinkFailed: true });
    expect(rpc).toHaveBeenCalledWith('owner_menu_link_help');
  });

  it('returns help without a suggestion when there is none', async () => {
    for (const suggested_link of [null, '', '   ', 5]) {
      rpc.mockResolvedValue({ data: [{ suggested_link }], error: null });
      await expect(getMenuLinkHelp()).resolves.toEqual({ suggestedLink: null, ownerLinkFailed: false });
    }
  });

  it('tells a working link apart from a failed read of the owner link', async () => {
    rpc.mockResolvedValue({ data: [{ suggested_link: 'https://good.example.com/menu', owner_link_failed: false }], error: null });
    await expect(getMenuLinkHelp()).resolves.toEqual({ suggestedLink: 'https://good.example.com/menu', ownerLinkFailed: false });
    rpc.mockResolvedValue({ data: [{ suggested_link: null, owner_link_failed: true }], error: null });
    await expect(getMenuLinkHelp()).resolves.toEqual({ suggestedLink: null, ownerLinkFailed: true });
  });

  it('is null when there is nothing to say, or the lookup fails', async () => {
    for (const data of [[], null, undefined]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(getMenuLinkHelp()).resolves.toBeNull();
    }
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    await expect(getMenuLinkHelp()).resolves.toBeNull();
  });
});

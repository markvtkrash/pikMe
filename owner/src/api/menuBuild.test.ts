jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));

import { supabase } from './supabase';
import { getMenuBuildStatus, MENU_BUILD_MESSAGE } from './menuBuild';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('getMenuBuildStatus', () => {
  it('returns the failure for the owner\'s own restaurant', async () => {
    rpc.mockResolvedValue({ data: [{ status: 'needs_attention', detail: 'Could not read dish names from the menu page' }], error: null });
    await expect(getMenuBuildStatus()).resolves.toEqual({ status: 'needs_attention', detail: 'Could not read dish names from the menu page' });
    expect(rpc).toHaveBeenCalledWith('owner_menu_build_status');
  });

  it('accepts a single row as well as a list, and a missing detail', async () => {
    rpc.mockResolvedValue({ data: { status: 'no_menu_link', detail: null }, error: null });
    await expect(getMenuBuildStatus()).resolves.toEqual({ status: 'no_menu_link', detail: null });
  });

  it('returns null when there is nothing to tell the owner', async () => {
    for (const data of [null, [], undefined]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(getMenuBuildStatus()).resolves.toBeNull();
    }
  });

  it('ignores a status that is not a failure', async () => {
    rpc.mockResolvedValue({ data: [{ status: 'built', detail: null }], error: null });
    await expect(getMenuBuildStatus()).resolves.toBeNull();
  });

  it('returns null, and never throws, when the lookup fails (so it cannot get in the way)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: 'function not found' } });
    await expect(getMenuBuildStatus()).resolves.toBeNull();
    warn.mockRestore();
  });
});

describe('MENU_BUILD_MESSAGE', () => {
  it('says what happened and what the owner can do', () => {
    expect(MENU_BUILD_MESSAGE).toMatch(/couldn't build your menu/);
    expect(MENU_BUILD_MESSAGE).toMatch(/photo/);
    expect(MENU_BUILD_MESSAGE).toMatch(/pasting the text/);
  });
});

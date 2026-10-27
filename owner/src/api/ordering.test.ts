jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));

import { supabase } from './supabase';
import { setMenuItemPrice, setOrderingEnabled, updateOrderingSettings } from './ordering';

const rpc = supabase.rpc as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('setOrderingEnabled', () => {
  it('turns ordering on or off for the restaurant', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await setOrderingEnabled('r1', true);
    expect(rpc).toHaveBeenLastCalledWith('owner_set_ordering_enabled', { p_restaurant_id: 'r1', p_enabled: true });
    await setOrderingEnabled('r1', false);
    expect(rpc).toHaveBeenLastCalledWith('owner_set_ordering_enabled', { p_restaurant_id: 'r1', p_enabled: false });
  });

  it('throws the server\'s reason, word for word', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Confirm at least one dish and give it a price before turning on ordering' } });
    await expect(setOrderingEnabled('r1', true)).rejects.toThrow('Confirm at least one dish and give it a price before turning on ordering');
  });
});

describe('updateOrderingSettings', () => {
  it('sends only what was given, the rest as null (the server leaves those as they are)', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await updateOrderingSettings('r1', { prepMinutes: 30 });
    expect(rpc).toHaveBeenLastCalledWith('owner_update_ordering_settings', { p_restaurant_id: 'r1', p_prep_minutes: 30, p_timezone: null });
    await updateOrderingSettings('r1', { timezone: 'America/Chicago' });
    expect(rpc).toHaveBeenLastCalledWith('owner_update_ordering_settings', { p_restaurant_id: 'r1', p_prep_minutes: null, p_timezone: 'America/Chicago' });
    await updateOrderingSettings('r1', { prepMinutes: 15, timezone: 'America/Denver' });
    expect(rpc).toHaveBeenLastCalledWith('owner_update_ordering_settings', { p_restaurant_id: 'r1', p_prep_minutes: 15, p_timezone: 'America/Denver' });
  });

  it('throws the server\'s reason', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'That timezone is not recognised. Use a name like America/Chicago' } });
    await expect(updateOrderingSettings('r1', { timezone: 'Central' })).rejects.toThrow('not recognised');
  });
});

describe('setMenuItemPrice', () => {
  it('sets a price in cents, and clears it with null', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await setMenuItemPrice('i1', 1250);
    expect(rpc).toHaveBeenLastCalledWith('owner_set_menu_item_price', { p_item_id: 'i1', p_price_cents: 1250 });
    await setMenuItemPrice('i1', null);
    expect(rpc).toHaveBeenLastCalledWith('owner_set_menu_item_price', { p_item_id: 'i1', p_price_cents: null });
  });

  it('throws the server\'s reason', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Not authorized to manage this restaurant' } });
    await expect(setMenuItemPrice('i1', 100)).rejects.toThrow('Not authorized');
  });
});

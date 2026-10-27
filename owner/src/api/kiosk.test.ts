jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } } }));

import { supabase } from './supabase';
import { getKioskLink, getKioskOrders, regenerateKioskLink, runKioskAction } from './kiosk';
import { isEndedError } from '../utils/kiosk';

const rpc = supabase.rpc as jest.Mock;
const invoke = (supabase.functions as any).invoke as jest.Mock;
const TOKEN = 'k_' + 'a'.repeat(64);

beforeEach(() => jest.clearAllMocks());

describe('getKioskOrders', () => {
  it('asks for the orders with the link\'s token and returns them', async () => {
    const data = { restaurant_name: 'Diner', expires_at: 'x', server_time: 'y', orders: [] };
    rpc.mockResolvedValue({ data, error: null });
    await expect(getKioskOrders(TOKEN)).resolves.toBe(data);
    expect(rpc).toHaveBeenCalledWith('kiosk_get_orders', { p_kiosk_token: TOKEN });
  });

  it('throws the server\'s message, which the screen recognises as an ended link', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'This link has expired or is not valid' } });
    const failure = await getKioskOrders(TOKEN).catch((e) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(isEndedError(failure.message)).toBe(true);
  });
});

describe('runKioskAction', () => {
  it.each([
    ['accept', 'kiosk_accept_order'],
    ['ready', 'kiosk_mark_order_ready'],
    ['completed', 'kiosk_mark_order_completed'],
  ] as const)('%s calls %s with the token and the order', async (action, fn) => {
    rpc.mockResolvedValue({ data: 'ok', error: null });
    await expect(runKioskAction(action, TOKEN, 'order-1')).resolves.toBe('ok');
    expect(rpc).toHaveBeenCalledWith(fn, { p_kiosk_token: TOKEN, p_order_id: 'order-1' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reject goes through the server function (so a paid order is refunded), not straight to the database', async () => {
    invoke.mockResolvedValue({ data: { result: 'ok', refund: 'refunded' }, error: null });
    await expect(runKioskAction('reject', TOKEN, 'order-1')).resolves.toBe('ok');
    expect(invoke).toHaveBeenCalledWith('kiosk-order-action', { body: { token: TOKEN, orderId: 'order-1', action: 'reject' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a rejected order that someone already moved comes back as wrong_state', async () => {
    invoke.mockResolvedValue({ data: { result: 'wrong_state', refund: 'nothing' }, error: null });
    await expect(runKioskAction('reject', TOKEN, 'order-1')).resolves.toBe('wrong_state');
  });

  it('a reject on an ended link throws the server\'s message, which the screen recognises', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'This link has expired or is not valid' }) } } });
    const failure = await runKioskAction('reject', TOKEN, 'order-1').catch((e) => e);
    expect(isEndedError(failure.message)).toBe(true);
  });

  it('a reject with no answer reads as not found', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await expect(runKioskAction('reject', TOKEN, 'order-1')).resolves.toBe('not_found');
  });

  it('passes on "wrong_state" (someone else moved the order first) instead of failing', async () => {
    rpc.mockResolvedValue({ data: 'wrong_state', error: null });
    await expect(runKioskAction('accept', TOKEN, 'order-1')).resolves.toBe('wrong_state');
  });

  it('throws when the link has ended', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'This link has expired or is not valid' } });
    await expect(runKioskAction('accept', TOKEN, 'order-1')).rejects.toThrow('expired or is not valid');
  });
});

describe('getKioskLink', () => {
  it('maps the row, accepting a list or a single row', async () => {
    const row = { link_token: TOKEN, link_expires_at: '2026-10-27T05:00:00Z', link_expired: false };
    rpc.mockResolvedValue({ data: [row], error: null });
    await expect(getKioskLink('r1')).resolves.toEqual({ token: TOKEN, expiresAt: '2026-10-27T05:00:00Z', expired: false });
    expect(rpc).toHaveBeenCalledWith('owner_get_kiosk_link', { p_restaurant_id: 'r1' });
    rpc.mockResolvedValue({ data: row, error: null });
    await expect(getKioskLink('r1')).resolves.toMatchObject({ token: TOKEN });
  });

  it('returns null when no link was ever made', async () => {
    for (const data of [[], null, undefined]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(getKioskLink('r1')).resolves.toBeNull();
    }
  });

  it('throws the server\'s message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Not authorized to manage this restaurant' } });
    await expect(getKioskLink('r1')).rejects.toThrow('Not authorized');
  });
});

describe('regenerateKioskLink', () => {
  it('asks for tonight\'s midnight with a null end, and returns the new link', async () => {
    rpc.mockResolvedValue({ data: [{ link_token: TOKEN, link_expires_at: '2026-10-27T05:00:00Z' }], error: null });
    await expect(regenerateKioskLink('r1', null)).resolves.toEqual({ token: TOKEN, expiresAt: '2026-10-27T05:00:00Z', expired: false });
    expect(rpc).toHaveBeenCalledWith('owner_regenerate_kiosk_token', { p_restaurant_id: 'r1', p_expires_at: null });
  });

  it('passes a custom end time', async () => {
    rpc.mockResolvedValue({ data: [{ link_token: TOKEN, link_expires_at: 'later' }], error: null });
    await regenerateKioskLink('r1', '2026-11-02T00:00:00.000Z');
    expect(rpc).toHaveBeenCalledWith('owner_regenerate_kiosk_token', { p_restaurant_id: 'r1', p_expires_at: '2026-11-02T00:00:00.000Z' });
  });

  it('throws the server\'s reason (for example ordering is off)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Turn on ordering before creating a staff link' } });
    await expect(regenerateKioskLink('r1', null)).rejects.toThrow('Turn on ordering');
  });

  it('throws when the server returns nothing', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(regenerateKioskLink('r1', null)).rejects.toThrow('could not be created');
  });
});

jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } } }));

import { supabase } from './supabase';
import {
  cancelMyOrder, createPickupOrder, functionErrorMessage, getMyOrder, getMyOrders, getOrderableDishes, getOrderingInfo, startPayment, testMarkPaid,
} from './orders';

const rpc = supabase.rpc as jest.Mock;
const invoke = (supabase.functions as any).invoke as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('getOrderingInfo', () => {
  it('reads the server\'s answer for the place', async () => {
    rpc.mockResolvedValue({ data: [{ ordering_available: true, prep_minutes: 25, restaurant_timezone: 'America/Chicago', orderable_count: 7 }], error: null });
    await expect(getOrderingInfo('P1')).resolves.toEqual({ available: true, prepMinutes: 25, timezone: 'America/Chicago', orderableCount: 7 });
    expect(rpc).toHaveBeenCalledWith('get_ordering_info', { p_place_id: 'P1' });
  });

  it('accepts a single row as well as a list', async () => {
    rpc.mockResolvedValue({ data: { ordering_available: true, prep_minutes: 20, restaurant_timezone: null, orderable_count: 1 }, error: null });
    await expect(getOrderingInfo('P1')).resolves.toMatchObject({ available: true });
  });

  it.each([
    ['an error', { data: null, error: { message: 'boom' } }],
    ['no row', { data: [], error: null }],
    ['a null answer', { data: null, error: null }],
    ['ordering not available', { data: [{ ordering_available: false, prep_minutes: 20, restaurant_timezone: 'America/Chicago', orderable_count: 3 }], error: null }],
    ['a value that is not exactly true', { data: [{ ordering_available: 'true', prep_minutes: 20 }], error: null }],
  ])('says "not available" for %s, so a failed lookup never shows an Order button', async (_name, response) => {
    rpc.mockResolvedValue(response);
    expect((await getOrderingInfo('P1')).available).toBe(false);
  });

  it('says "not available" when the call itself throws', async () => {
    rpc.mockRejectedValue(new Error('offline'));
    await expect(getOrderingInfo('P1')).resolves.toMatchObject({ available: false });
  });

  it('falls back to a 20 minute prep time when the server gives none', async () => {
    rpc.mockResolvedValue({ data: [{ ordering_available: true }], error: null });
    await expect(getOrderingInfo('P1')).resolves.toMatchObject({ prepMinutes: 20, timezone: null, orderableCount: 0 });
  });
});

describe('getOrderableDishes', () => {
  const row = (over: Record<string, unknown>) => ({
    item_id: 'i', restaurant_name: 'Diner', name: 'Dish', is_verified: true, calories: 1, total_fat_g: 0, saturated_fat_g: 0, sodium_mg: 0,
    total_carbs_g: 0, protein_g: 0, price_cents: 1000, ...over,
  });

  it('asks for the place\'s menu and keeps the confirmed, priced dishes', async () => {
    rpc.mockResolvedValue({
      data: [row({ item_id: 'b', name: 'Fries', price_cents: 500 }), row({ item_id: 'a', name: 'Burger', price_cents: 1250 }), row({ item_id: 'c', is_verified: false }), row({ item_id: 'd', price_cents: null })],
      error: null,
    });
    await expect(getOrderableDishes('P1', 'Diner')).resolves.toEqual([
      { itemId: 'a', name: 'Burger', priceCents: 1250 },
      { itemId: 'b', name: 'Fries', priceCents: 500 },
    ]);
    expect(rpc).toHaveBeenCalledWith('get_menu_items_for_restaurant', { p_place_id: 'P1', p_restaurant_name: 'Diner' });
  });

  it('is empty for an empty menu, and throws the server\'s message on an error', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getOrderableDishes('P1', 'Diner')).resolves.toEqual([]);
    rpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(getOrderableDishes('P1', 'Diner')).rejects.toThrow('nope');
  });
});

describe('createPickupOrder', () => {
  const order = { placeId: 'P1', items: [{ item_id: 'a', quantity: 2 }], customerName: 'Ann', pickupAtMs: null, note: '  ', key: 'k1' };

  it('sends dishes and quantities only, a null time for "as soon as possible", and no note when blank', async () => {
    rpc.mockResolvedValue({ data: { order_id: 'o1' }, error: null });
    await expect(createPickupOrder(order)).resolves.toEqual({ order_id: 'o1' });
    expect(rpc).toHaveBeenCalledWith('create_pickup_order', {
      p_place_id: 'P1', p_items: [{ item_id: 'a', quantity: 2 }], p_customer_name: 'Ann', p_pickup_at: null, p_note: null, p_idempotency_key: 'k1',
    });
    expect(JSON.stringify(rpc.mock.calls[0][1])).not.toContain('price');
  });

  it('sends a chosen time as an ISO moment, and the note', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await createPickupOrder({ ...order, pickupAtMs: Date.parse('2026-10-26T19:30:00Z'), note: 'by the door' });
    expect(rpc).toHaveBeenCalledWith('create_pickup_order', expect.objectContaining({ p_pickup_at: '2026-10-26T19:30:00.000Z', p_note: 'by the door' }));
  });

  it('throws the server\'s message word for word', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'This restaurant is not taking orders right now' } });
    await expect(createPickupOrder(order)).rejects.toThrow('This restaurant is not taking orders right now');
  });
});

describe('the other order calls', () => {
  it('getMyOrder returns the order, or null when it is not yours', async () => {
    rpc.mockResolvedValue({ data: { order_id: 'o1' }, error: null });
    await expect(getMyOrder('o1')).resolves.toEqual({ order_id: 'o1' });
    expect(rpc).toHaveBeenCalledWith('get_my_order', { p_order_id: 'o1' });
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMyOrder('o2')).resolves.toBeNull();
  });

  it('getMyOrders passes the limit and returns a list (empty when none)', async () => {
    rpc.mockResolvedValue({ data: [{ order_id: 'o1' }], error: null });
    await expect(getMyOrders(5)).resolves.toEqual([{ order_id: 'o1' }]);
    expect(rpc).toHaveBeenCalledWith('get_my_orders', { p_limit: 5 });
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMyOrders()).resolves.toEqual([]);
  });

  it('testMarkPaid passes the result through, and throws the server\'s message on an error', async () => {
    rpc.mockResolvedValue({ data: 'ok', error: null });
    await expect(testMarkPaid('o1')).resolves.toBe('ok');
    expect(rpc).toHaveBeenCalledWith('test_mark_my_order_paid', { p_order_id: 'o1' });
    rpc.mockResolvedValue({ data: null, error: { message: 'Test payments are switched off' } });
    await expect(testMarkPaid('o1')).rejects.toThrow('switched off');
  });
});

describe('cancelMyOrder', () => {
  it('goes through the server function, so a paid order is refunded', async () => {
    invoke.mockResolvedValue({ data: { result: 'ok', refund: 'refunded' }, error: null });
    await expect(cancelMyOrder('o1')).resolves.toBe('ok');
    expect(invoke).toHaveBeenCalledWith('customer-cancel-order', { body: { orderId: 'o1' } });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('passes "wrong_state" through (the restaurant already started on it)', async () => {
    invoke.mockResolvedValue({ data: { result: 'wrong_state', refund: 'nothing' }, error: null });
    await expect(cancelMyOrder('o1')).resolves.toBe('wrong_state');
  });
  it('reads no answer as not found, and throws the server\'s message on an error', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await expect(cancelMyOrder('o1')).resolves.toBe('not_found');
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'Unauthorized' }) } } });
    await expect(cancelMyOrder('o1')).rejects.toThrow('Unauthorized');
  });
});

describe('startPayment', () => {
  it('asks for the payment page of the order and returns its address', async () => {
    invoke.mockResolvedValue({ data: { url: 'https://checkout.stripe.com/c/pay/cs_test_1' }, error: null });
    await expect(startPayment('o1')).resolves.toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(invoke).toHaveBeenCalledWith('create-order-checkout', { body: { orderId: 'o1' } });
  });
  it('throws the server\'s reason (for example the restaurant cannot take cards yet)', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'This restaurant cannot take card payments yet' }) } } });
    await expect(startPayment('o1')).rejects.toThrow('cannot take card payments yet');
  });
  it('throws a plain message when no page comes back', async () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    await expect(startPayment('o1')).rejects.toThrow('Payment could not be started');
    invoke.mockResolvedValue({ data: null, error: {} });
    await expect(startPayment('o1')).rejects.toThrow('Payment could not be started');
  });
});

describe('functionErrorMessage', () => {
  it('reads the server\'s message, or falls back', async () => {
    await expect(functionErrorMessage({ context: { json: async () => ({ error: 'Nope' }) } }, 'fallback')).resolves.toBe('Nope');
    await expect(functionErrorMessage({}, 'fallback')).resolves.toBe('fallback');
    await expect(functionErrorMessage({ context: { json: async () => { throw new Error('used'); } } }, 'fallback')).resolves.toBe('fallback');
  });
});

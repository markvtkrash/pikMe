jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } } }));

import { supabase } from './supabase';
import { functionErrorMessage, getPaymentStatus, refreshStripeStatus, startStripeOnboarding } from './payments';

const rpc = supabase.rpc as jest.Mock;
const invoke = (supabase.functions as any).invoke as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('functionErrorMessage', () => {
  it('reads the server\'s message out of the error', async () => {
    const error = { context: { json: async () => ({ error: 'Payments are not set up on the server yet' }) } };
    await expect(functionErrorMessage(error, 'fallback')).resolves.toBe('Payments are not set up on the server yet');
  });
  it.each([
    ['no context', {}],
    ['an unreadable body', { context: { json: async () => { throw new Error('body used already'); } } }],
    ['a body without an error', { context: { json: async () => ({}) } }],
    ['an empty error', { context: { json: async () => ({ error: '' }) } }],
    ['nothing at all', undefined],
  ])('uses the fallback for %s', async (_name, error) => {
    await expect(functionErrorMessage(error, 'fallback')).resolves.toBe('fallback');
  });
});

describe('getPaymentStatus', () => {
  it('maps the owner\'s payment status', async () => {
    rpc.mockResolvedValue({ data: [{ is_connected: true, can_take_payments: false, can_receive_payouts: false, details_submitted: true, payment_required: true }], error: null });
    await expect(getPaymentStatus('r1')).resolves.toEqual({ connected: true, canTakePayments: false, payoutsEnabled: false, detailsSubmitted: true, required: true });
    expect(rpc).toHaveBeenCalledWith('owner_get_payment_status', { p_restaurant_id: 'r1' });
  });
  it('treats anything that is not exactly true as false', async () => {
    rpc.mockResolvedValue({ data: { is_connected: 'yes', can_take_payments: null }, error: null });
    await expect(getPaymentStatus('r1')).resolves.toEqual({ connected: false, canTakePayments: false, payoutsEnabled: false, detailsSubmitted: false, required: false });
  });
  it('throws the server\'s message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Not authorized to manage this restaurant' } });
    await expect(getPaymentStatus('r1')).rejects.toThrow('Not authorized');
  });
});

describe('startStripeOnboarding', () => {
  it('asks for the page to send the owner to and returns its address', async () => {
    invoke.mockResolvedValue({ data: { url: 'https://connect.stripe.com/setup/abc' }, error: null });
    await expect(startStripeOnboarding('r1')).resolves.toBe('https://connect.stripe.com/setup/abc');
    expect(invoke).toHaveBeenCalledWith('restaurant-connect-onboarding', { body: { restaurantId: 'r1', action: 'start' } });
  });
  it('throws the server\'s reason', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'The owner site address is not set on the server yet' }) } } });
    await expect(startStripeOnboarding('r1')).rejects.toThrow('owner site address');
  });
  it('throws when no address comes back', async () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    await expect(startStripeOnboarding('r1')).rejects.toThrow('did not give a page');
  });
});

describe('refreshStripeStatus', () => {
  it('returns where the account stands', async () => {
    invoke.mockResolvedValue({ data: { connected: true, canTakePayments: true, payoutsEnabled: true, detailsSubmitted: true }, error: null });
    await expect(refreshStripeStatus('r1')).resolves.toEqual({
      connected: true, canTakePayments: true, payoutsEnabled: true, detailsSubmitted: true,
      cardPaymentsStatus: null, cardPaymentsReasons: [], payoutsStatus: null,
    });
    expect(invoke).toHaveBeenCalledWith('restaurant-connect-onboarding', { body: { restaurantId: 'r1', action: 'refresh' } });
  });

  it('passes on what Stripe itself said, and why it is not ready', async () => {
    invoke.mockResolvedValue({
      data: { connected: true, canTakePayments: false, payoutsEnabled: false, detailsSubmitted: false,
        cardPaymentsStatus: 'restricted', cardPaymentsReasons: ['requirements_past_due', 5, 'verification_failed'], payoutsStatus: 'restricted' },
      error: null,
    });
    await expect(refreshStripeStatus('r1')).resolves.toMatchObject({
      cardPaymentsStatus: 'restricted', cardPaymentsReasons: ['requirements_past_due', 'verification_failed'], payoutsStatus: 'restricted',
    });
  });
  it('throws a plain message when the call fails', async () => {
    invoke.mockResolvedValue({ data: null, error: {} });
    await expect(refreshStripeStatus('r1')).rejects.toThrow('Could not check with Stripe');
  });
});

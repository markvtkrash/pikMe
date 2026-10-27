import { supabase } from './supabase';

// The owner's calls for getting paid through Stripe (migration 170 and the restaurant-connect-onboarding function). The owner's bank and
// business details are entered on Stripe's own pages, never in pikMe.

export interface PaymentStatus {
  connected: boolean;          // a Stripe account exists for the restaurant
  canTakePayments: boolean;    // Stripe has finished checking it and it can charge cards
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  required: boolean;           // ordering needs it (the admin setting orderingRequirePaymentAccount)
}

// The text of an error from an edge function (supabase-js hides the server's message inside the error).
export async function functionErrorMessage(error: any, fallback: string): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch {
    // the body was not readable: use the fallback
  }
  return fallback;
}

export async function getPaymentStatus(restaurantId: string): Promise<PaymentStatus> {
  const { data, error } = await supabase.rpc('owner_get_payment_status', { p_restaurant_id: restaurantId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    connected: row?.is_connected === true,
    canTakePayments: row?.can_take_payments === true,
    payoutsEnabled: row?.can_receive_payouts === true,
    detailsSubmitted: row?.details_submitted === true,
    required: row?.payment_required === true,
  };
}

// Where to send the owner to enter their details on Stripe (the Stripe account is made the first time).
export async function startStripeOnboarding(restaurantId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('restaurant-connect-onboarding', { body: { restaurantId, action: 'start' } });
  if (error) throw new Error(await functionErrorMessage(error, 'Could not start the Stripe setup'));
  if (!data?.url || typeof data.url !== 'string') throw new Error('Stripe did not give a page to continue on');
  return data.url;
}

// What Stripe itself reports, for showing why an account is not ready yet (for example card payments "restricted", with the reason).
export interface StripeReport {
  cardPaymentsStatus: string | null;
  cardPaymentsReasons: string[];
  payoutsStatus: string | null;
}

// Asks Stripe where the account stands now and saves it, so the page does not wait for Stripe's own message.
export async function refreshStripeStatus(restaurantId: string): Promise<Omit<PaymentStatus, 'required'> & StripeReport> {
  const { data, error } = await supabase.functions.invoke('restaurant-connect-onboarding', { body: { restaurantId, action: 'refresh' } });
  if (error) throw new Error(await functionErrorMessage(error, 'Could not check with Stripe'));
  return {
    connected: data?.connected === true,
    canTakePayments: data?.canTakePayments === true,
    payoutsEnabled: data?.payoutsEnabled === true,
    detailsSubmitted: data?.detailsSubmitted === true,
    cardPaymentsStatus: typeof data?.cardPaymentsStatus === 'string' ? data.cardPaymentsStatus : null,
    cardPaymentsReasons: Array.isArray(data?.cardPaymentsReasons) ? data.cardPaymentsReasons.filter((r: unknown) => typeof r === 'string') : [],
    payoutsStatus: typeof data?.payoutsStatus === 'string' ? data.payoutsStatus : null,
  };
}

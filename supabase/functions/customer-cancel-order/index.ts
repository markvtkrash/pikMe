import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, fail, json, serviceClient, signedInUser, stripeKey, userClient } from '../_shared/http.ts';
import { refundOrder } from '../_shared/refunds.ts';

// The customer cancels their own order. Before payment that is all there is to it; after payment (and before the restaurant accepts) the
// database marks the refund pending and this function then asks Stripe for it, since only the server can.
//   { orderId } -> { result: 'ok' | 'wrong_state' | 'not_found', refund: 'refunded' | 'pending' | 'failed' | 'nothing' }
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  try {
    const user = await signedInUser(req);
    if (!user) return fail('Unauthorized', 401);

    const { orderId } = await req.json().catch(() => ({}));
    if (typeof orderId !== 'string' || !orderId) return fail('orderId is required');

    // as the customer: the database itself checks the order is theirs and still cancellable
    const { data: result, error } = await userClient(req).rpc('customer_cancel_order', { p_order_id: orderId });
    if (error) return fail(error.message);
    const refund = result === 'ok' ? await refundOrder(serviceClient(), stripeKey(), orderId) : 'nothing';
    return json({ result, refund });
  } catch (e) {
    console.error('[customer-cancel-order]', e);
    return fail(e instanceof Error ? e.message : 'Something went wrong', 500);
  }
});

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, fail, json, serviceClient, stripeKey } from '../_shared/http.ts';
import { refundOrder } from '../_shared/refunds.ts';

// The staff tablet rejects an order here (not straight in the database) because a rejected, paid order must be refunded, and only the
// server can talk to Stripe. The link's token is the credential, checked by the database function exactly as for the other actions.
//   { token, orderId, action: 'reject' } -> { result: 'ok' | 'wrong_state' | 'not_found', refund: 'refunded' | 'pending' | 'failed' | 'nothing' }
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  try {
    const { token, orderId, action } = await req.json().catch(() => ({}));
    if (typeof token !== 'string' || typeof orderId !== 'string') return fail('token and orderId are required');
    if (action !== 'reject') return fail('action must be reject');

    const db = serviceClient();
    const { data: result, error } = await db.rpc('kiosk_reject_order', { p_kiosk_token: token, p_order_id: orderId });
    if (error) {
      // a bad or ended link: the same message the screen already understands
      return fail(error.message, error.message.includes('expired or is not valid') ? 401 : 400);
    }
    // an order that was never paid has nothing to refund (its refund state stays 'none')
    const refund = result === 'ok' ? await refundOrder(db, stripeKey(), orderId) : 'nothing';
    return json({ result, refund });
  } catch (e) {
    console.error('[kiosk-order-action]', e);
    return fail(e instanceof Error ? e.message : 'Something went wrong', 500);
  }
});

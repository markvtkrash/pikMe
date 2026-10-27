import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, fail, json, serviceClient, stripeKey } from '../_shared/http.ts';
import { refundOrder } from '../_shared/refunds.ts';

// A safety net, run on a schedule (or by hand): retries every refund still 'pending' (Stripe was unreachable when it was asked) and
// cancels orders left unpaid for 30 minutes. Protected by a shared secret in the x-orders-secret header (secret ORDERS_CRON_SECRET).
//   POST -> { refunded, pending, failed, cancelledUnpaid }
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  const expected = Deno.env.get('ORDERS_CRON_SECRET');
  if (!expected || req.headers.get('x-orders-secret') !== expected) return fail('Unauthorized', 401);

  try {
    const db = serviceClient();
    const secret = stripeKey();
    const { data: pending, error } = await db.from('orders').select('id').eq('refund_status', 'pending').order('updated_at').limit(50);
    if (error) throw error;

    const counts = { refunded: 0, pending: 0, failed: 0, nothing: 0 };
    for (const o of pending ?? []) counts[await refundOrder(db, secret, o.id)]++;

    const { data: cancelledUnpaid } = await db.rpc('cancel_stale_pending_orders', { p_minutes: 30 });
    return json({ ...counts, cancelledUnpaid: cancelledUnpaid ?? 0 });
  } catch (e) {
    console.error('[process-pending-refunds]', e);
    return fail(e instanceof Error ? e.message : 'Something went wrong', 500);
  }
});

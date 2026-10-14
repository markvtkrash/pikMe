import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ALLOW_ALL, checkRegion, validCoords } from './regionGate.ts';

// The customer app asks, once per location, whether the state it is in is open (migration 142). Any signed-in user may ask. An admin or an owner
// is always let in so they can look at a state that is not open yet. Answers { enforced, allowed, status, stateCode, name, goLiveAt, countryCode }.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const authed = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authed.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);

    const { latitude, longitude } = await req.json().catch(() => ({}));
    if (!validCoords(latitude, longitude)) return json({ error: 'latitude and longitude are required' }, 400);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // staff are never blocked
    const userId = userData.user.id;
    const { data: admin } = await supabase.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').limit(1);
    const { data: owner } = await supabase.from('restaurant_owners').select('id').eq('id', userId).limit(1);
    if ((admin && admin.length > 0) || (owner && owner.length > 0)) return json({ ...ALLOW_ALL, staff: true });

    const access = await checkRegion(supabase, Deno.env.get('GOOGLE_PLACES_KEY'), latitude, longitude);
    return json(access);
  } catch (e) {
    // an error must never lock a customer out
    console.error('[region-access] error:', e);
    return json({ ...ALLOW_ALL, error: true });
  }
});

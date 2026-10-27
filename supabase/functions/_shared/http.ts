import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-orders-secret',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

// The server's own database client: it can do what no customer or owner can (it is never handed to the app).
export function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

// A client that acts AS the signed-in person (their login travels with it), so the database sees them as auth.uid().
export function userClient(req: Request) {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
}

// The signed-in person, or null.
export async function signedInUser(req: Request) {
  const header = req.headers.get('Authorization');
  if (!header) return null;
  const { data, error } = await userClient(req).auth.getUser(header.replace(/^Bearer\s+/i, ''));
  return error || !data.user ? null : data.user;
}

export function stripeKey(): string | null {
  return Deno.env.get('STRIPE_SECRET_KEY') || null;
}

// Where Stripe sends people back to. Set as edge function secrets (no trailing slash).
export function appUrl(name: 'USER_APP_URL' | 'OWNER_APP_URL'): string | null {
  const v = Deno.env.get(name);
  return v ? v.replace(/\/+$/, '') : null;
}

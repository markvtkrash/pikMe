import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    `Missing Supabase config. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env.local\n` +
    `Got: URL="${supabaseUrl}", Key="${supabaseAnonKey?.slice(0, 10)}..."`
  );
}

// TEMP DEBUG — remove once the "Not authorized" mismatch is diagnosed. Wraps
// the client's own fetch so we see the literal outgoing headers for
// verify_menu_item, instead of inferring them from a separate getSession()
// call that could theoretically race with what the SDK actually sends.
async function debugFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (url.includes('/rpc/verify_menu_item')) {
    const headers = new Headers(init?.headers ?? (input as Request)?.headers);
    console.log('[supabase debugFetch] URL:', url);
    console.log('[supabase debugFetch] has authorization header:', headers.has('authorization'));
    console.log('[supabase debugFetch] authorization value (first 30 chars):', headers.get('authorization')?.slice(0, 30));
    console.log('[supabase debugFetch] all header keys:', Array.from(headers.keys()));
  }
  return fetch(input, init);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: debugFetch,
  },
});

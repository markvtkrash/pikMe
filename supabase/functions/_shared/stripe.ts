// Talks to Stripe's REST API with fetch (no library to keep in step). Server side only: the secret key never leaves the edge function.
import { encodeForm, type FormValue } from './stripeUtils.ts';

export class StripeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const API = 'https://api.stripe.com';

export async function stripeRequest<T = any>(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  params?: Record<string, FormValue>,
  options: { account?: string; idempotencyKey?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${secretKey}` };
  // acting AS the restaurant's own account: this is what makes a payment a direct charge on it
  if (options.account) headers['Stripe-Account'] = options.account;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let url = `${API}${path}`;
  let body: string | undefined;
  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encodeForm(params ?? {});
  } else if (params && Object.keys(params).length > 0) {
    url += `?${encodeForm(params)}`;
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (e) {
    // the network failed: treated as a temporary problem (status 0), so a refund sweep tries again
    throw new StripeError(e instanceof Error ? e.message : 'could not reach Stripe', 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new StripeError(json?.error?.message ?? `Stripe returned ${res.status}`, res.status);
  return json as T;
}

// Stripe's Accounts v2 API takes and returns JSON (not form fields) and wants an API version. The version can be changed with the secret
// STRIPE_API_VERSION if Stripe retires this one.
const V2_VERSION = '2026-09-30.endive';

export async function stripeV2Request<T = any>(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, FormValue>,
  options: { idempotencyKey?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': Deno.env.get('STRIPE_API_VERSION') || V2_VERSION,
  };
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let url = `${API}${path}`;
  if (query && Object.keys(query).length > 0) url += `?${encodeForm(query)}`;
  let init: RequestInit = { method, headers };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    init = { method, headers, body: JSON.stringify(body ?? {}) };
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new StripeError(e instanceof Error ? e.message : 'could not reach Stripe', 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new StripeError(json?.error?.message ?? `Stripe returned ${res.status}`, res.status);
  return json as T;
}

// Failures worth trying again later: the network, a Stripe outage, or rate limiting.
export function isTemporary(e: unknown): boolean {
  return e instanceof StripeError && (e.status === 0 || e.status === 429 || e.status >= 500);
}

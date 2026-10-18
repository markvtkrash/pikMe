import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Cached per warm isolate (not per-request) so switching APP_CONFIG_SOURCE=db
// on doesn't add a DB round-trip to every single invocation — refreshed only
// on the next cold start, same "load once" model used by the client apps.
let cachedDbConfig: Record<string, string> | null = null;
// The config is kept for a few minutes, then read again, so a changed setting applies without a redeploy. The cache is for
// one list of keys: a call with a different list reads again.
let cachedDbConfigAt = 0;
let cachedDbConfigSig = '';
const DB_CONFIG_TTL_MS = 5 * 60 * 1000;
async function loadDbConfig(keys: string[]): Promise<Record<string, string>> {
  if (Deno.env.get('APP_CONFIG_SOURCE') !== 'db') return {};
  const sig = [...keys].sort().join(',');
  if (cachedDbConfig && cachedDbConfigSig === sig && Date.now() - cachedDbConfigAt < DB_CONFIG_TTL_MS) return cachedDbConfig;
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await client.from('app_config').select('key, value').in('key', keys);
    if (error) throw error;
    cachedDbConfig = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    cachedDbConfigAt = Date.now();
    cachedDbConfigSig = sig;
    return cachedDbConfig;
  } catch (loadErr) {
    console.error('[extract-menu-from-link] Failed to load DB config, falling back to env/defaults:', loadErr);
    return {};
  }
}

// ── SSRF guard ──────────────────────────────────────────────────────────────
// This function does a server-side fetch() of a URL an owner supplies, so
// without this check they could point it at an internal/cloud-metadata
// address (e.g. 169.254.169.254, localhost, a 10.x/192.168.x service) that
// the public internet can't reach but this server can, and get the response
// summarized back to them. Blocks IP-literal hosts in private/reserved
// ranges outright, plus a denylist of well-known internal hostnames, and
// best-effort checks DNS resolution for named hosts too (defense in depth —
// Deno.resolveDns may not be permitted in this runtime, in which case that
// check is silently skipped and the IP-literal/denylist checks still apply).
//
// NOTE: this logic is intentionally duplicated in refresh-restaurant-menu
// rather than shared via a _shared/ import — this self-hosted instance
// deploys each function folder independently and does not bundle a shared
// directory alongside them, so cross-function imports fail at boot
// ("Module not found .../_shared/...") even though that's a normal pattern
// on Supabase's hosted platform. Keep both copies in sync if this changes.

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const long = ipv4ToLong(ip);
  if (long === null) return false;
  const inRange = (base: string, bits: number) => {
    const baseLong = ipv4ToLong(base)!;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (long & mask) === (baseLong & mask);
  };
  return (
    inRange('0.0.0.0', 8) ||
    inRange('10.0.0.0', 8) ||
    inRange('100.64.0.0', 10) ||
    inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) ||
    inRange('172.16.0.0', 12) ||
    inRange('192.0.0.0', 24) ||
    inRange('192.168.0.0', 16) ||
    inRange('198.18.0.0', 15) ||
    inRange('224.0.0.0', 4) ||
    inRange('240.0.0.0', 4)
  );
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (/^fe[89ab]/.test(lower)) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIpv4(mapped[1]);
  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain',
  'metadata', 'metadata.google.internal', 'metadata.internal',
]);

function isBlockedHostLiteral(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return isPrivateOrReservedIpv4(h);
  if (h.includes(':')) return isPrivateOrReservedIpv6(h);
  return false;
}

async function resolvesToBlockedIp(hostname: string): Promise<boolean> {
  try {
    // @ts-ignore — Deno.resolveDns isn't in the lib.deno.d.ts version this
    // repo's editor tooling uses, but is available at runtime where permitted.
    const dnsApi = (Deno as any).resolveDns;
    if (!dnsApi) return false;
    const [a, aaaa] = await Promise.all([
      dnsApi(hostname, 'A').catch(() => [] as string[]),
      dnsApi(hostname, 'AAAA').catch(() => [] as string[]),
    ]);
    return (a as string[]).some(isPrivateOrReservedIpv4) || (aaaa as string[]).some(isPrivateOrReservedIpv6);
  } catch {
    return false;
  }
}

async function isSafeUrl(url: URL): Promise<boolean> {
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (isBlockedHostLiteral(url.hostname)) return false;
  if (await resolvesToBlockedIp(url.hostname)) return false;
  return true;
}

// fetch() follows redirects by default, which would let a URL that passes
// the SSRF check above get server-side-redirected to a blocked address
// afterward. Real menu pages do legitimately redirect sometimes (www,
// http->https, CDN), so this validates and follows each hop manually rather
// than blocking all redirects outright.
async function safeFetch(startUrl: URL, init: RequestInit, maxRedirects = 5): Promise<Response> {
  let url = startUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(url.toString(), { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location')!, url);
      if (!(await isSafeUrl(next))) {
        throw new Error('Redirected to a restricted address');
      }
      url = next;
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

const DEFAULT_LINK_EXTRACT_MAX_TOKENS = 8192;
const MIN_LINK_EXTRACT_MAX_TOKENS = 1024;
const MAX_LINK_EXTRACT_MAX_TOKENS = 32000;

// The linkExtractMaxTokens setting (app_config, else the env var, else the default) -- shared with
// refresh-restaurant-menu (migration 153), same fix migration 109 already gave extract-menu-from-text's
// textExtractMaxTokens: a reply cut short here silently drops the rest of a long real menu, which looks
// like items are being capped even though nothing actually limits how many are returned.
function parseMaxTokens(...candidates: (string | null | undefined)[]): number {
  for (const raw of candidates) {
    const text = (raw ?? '').trim();
    if (!/^[0-9]{1,6}$/.test(text)) continue;
    const n = Number(text);
    if (n >= MIN_LINK_EXTRACT_MAX_TOKENS && n <= MAX_LINK_EXTRACT_MAX_TOKENS) return n;
  }
  return DEFAULT_LINK_EXTRACT_MAX_TOKENS;
}

async function deterministicId(restaurantName: string, itemName: string): Promise<string> {
  const text = `${restaurantName}::${itemName}::link`.toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return 'link_' + hex.slice(0, 24);
}

// Crude but dependency-free HTML → visible-text extraction. Good enough for
// server-rendered menu pages. JS-rendered SPAs won't have their menu in the
// raw HTML at all, so they are not readable here.
//
// Block-level tag boundaries become newlines before tags are stripped, so
// the output stays one-row-per-line instead of one continuous run-on blob —
// that line structure is the main signal the LLM has for telling where one
// menu item ends and the next begins. td/th deliberately excluded — they're
// cells within one row, so a boundary there would split a single item
// across lines. Only tr breaks between rows.
const BLOCK_TAGS =
  'div|p|li|tr|h[1-6]|section|article|header|footer|nav|ul|ol|table|thead|tbody|dd|dt|dl|blockquote|br|hr';
const BLOCK_TAG_BOUNDARY = new RegExp(`</?(?:${BLOCK_TAGS})[^>]*>`, 'gi');

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(BLOCK_TAG_BOUNDARY, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

interface NormalizedItem {
  itemId: string;
  restaurantName: string;
  name: string;
  imageUrl: null;
  isVerified: boolean;
  nutrition: {
    calories: number;
    totalFat_g: number;
    saturatedFat_g: number;
    sodium_mg: number;
    totalCarbs_g: number;
    dietaryFiber_g: number;
    sugars_g: number;
    protein_g: number;
    servingWeightGrams: number | null;
  };
}

interface ExtractResult {
  items: NormalizedItem[];
  error?: string;
}

// Sends real page text to the LLM and asks it to EXTRACT, not invent.
async function extractItemsFromText(pageText: string, restaurantName: string): Promise<ExtractResult> {
  const dbConfig = await loadDbConfig(['aiProvider', 'claudeModel', 'quicksilverModel', 'linkExtractMaxTokens']);
  const AI_PROVIDER = dbConfig.aiProvider ?? Deno.env.get('AI_PROVIDER') ?? 'claude';
  const CLAUDE_MODEL = dbConfig.claudeModel ?? Deno.env.get('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001';
  const QUICKSILVER_MODEL = dbConfig.quicksilverModel ?? Deno.env.get('QUICKSILVER_MODEL') ?? 'deepseek-v4-flash';
  const MAX_TOKENS = parseMaxTokens(dbConfig.linkExtractMaxTokens, Deno.env.get('LINK_EXTRACT_MAX_TOKENS'));

  const prompt = `Below is the real, scraped text content of a restaurant's menu webpage for "${restaurantName}". Extract the ACTUAL menu items explicitly present in this text. Do NOT invent, guess, or add items that aren't there. If this text does not appear to contain a real menu, return an empty JSON array: [].

For each real item found, estimate reasonable nutrition values (this app shows nutrition estimates for restaurant food, so approximate is fine — but the item NAME must be real, taken directly from the text).

Return ONLY a JSON array, no markdown or explanation. Each item must have these exact fields with numeric values (no strings):
- name (string, copied from the real menu text)
- calories (number)
- protein_g (number)
- totalCarbs_g (number)
- totalFat_g (number)
- saturatedFat_g (number)
- sodium_mg (number)
- dietaryFiber_g (number)
- sugars_g (number)

Menu page text:
"""
${pageText}
"""`;

  let apiKey: string;
  if (AI_PROVIDER === 'quicksilver') {
    apiKey = Deno.env.get('QUICKSILVER_API_KEY') || '';
    if (!apiKey) throw new Error('QUICKSILVER_API_KEY secret not configured');
  } else {
    apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret not configured');
  }

  let rawText: string;
  if (AI_PROVIDER === 'quicksilver') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch('https://api.quicksilverpro.io/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: QUICKSILVER_MODEL,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: MAX_TOKENS,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const body = await res.text();
        return { items: [], error: `Quicksilver API error ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = await res.json();
      rawText = data.choices?.[0]?.message?.content ?? '';
    } catch (e) {
      clearTimeout(timeout);
      if (e instanceof Error && e.name === 'AbortError') return { items: [], error: 'Quicksilver timed out.' };
      throw e;
    }
  } else {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[extract-menu-from-link] Claude error:', res.status, body);
      return { items: [], error: `Claude API returned ${res.status}` };
    }
    const claudeData = await res.json();
    rawText = claudeData.content?.[0]?.text ?? '';
  }

  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let rawItems: unknown[];
  try {
    rawItems = JSON.parse(cleaned);
    if (!Array.isArray(rawItems)) throw new Error('Response is not an array');
  } catch {
    // The model sometimes wraps the array in an explanation instead of
    // returning it bare, especially when the page has no real menu (e.g. a
    // locations/contact page) — it explains that instead of just sending
    // "[]" like instructed. Pull out the first [...] substring rather than
    // failing outright.
    const match = cleaned.match(/\[[\s\S]*\]/);
    try {
      rawItems = match ? JSON.parse(match[0]) : [];
      if (!Array.isArray(rawItems)) throw new Error('Extracted content is not an array');
    } catch (e2) {
      console.error('[extract-menu-from-link] JSON parse failed:', e2, 'raw:', rawText.slice(0, 500));
      return { items: [], error: "Couldn't find a real menu on that page." };
    }
  }

  const items = await Promise.all(
    (rawItems as Record<string, unknown>[])
      .filter((i) => i.name && Number(i.calories) > 0)
      .map(async (i) => ({
        itemId: await deterministicId(restaurantName, String(i.name)),
        restaurantName,
        name: String(i.name),
        imageUrl: null,
        isVerified: true, // extracted from a real page, not invented
        nutrition: {
          calories: Math.round(Number(i.calories) || 0),
          totalFat_g: Number(i.totalFat_g) || 0,
          saturatedFat_g: Number(i.saturatedFat_g) || 0,
          sodium_mg: Math.round(Number(i.sodium_mg) || 0),
          totalCarbs_g: Number(i.totalCarbs_g) || 0,
          dietaryFiber_g: Number(i.dietaryFiber_g) || 0,
          sugars_g: Number(i.sugars_g) || 0,
          protein_g: Number(i.protein_g) || 0,
          servingWeightGrams: i.servingWeightGrams ? Number(i.servingWeightGrams) : null,
        },
      }))
  );

  if (items.length === 0) {
    return { items: [], error: 'No real items found on that page' };
  }
  return { items };
}

const MAX_PDF_BYTES = 15 * 1024 * 1024; // keep the edge function's memory/time bounded
const MAX_PDF_PAGES = 30; // a real menu PDF is a handful of pages; this guards against an abusive upload
const PDF_PARSE_TIMEOUT_MS = 20000; // unpdf's serverless build parses on this isolate's event loop, with no worker to bound it itself

// Pulls the real text out of a PDF's raw bytes with unpdf (a PDF.js-based parser built for edge/serverless
// runtimes -- Deno included -- with no filesystem or canvas dependency for text extraction, which is all
// this needs; it never renders a page to an image). Returns plain text, same shape the HTML path already
// produces, so the actual item extraction below doesn't need to know or care that the source was a PDF.
// unpdf is loaded dynamically, only once a PDF actually turns up -- the same esm.sh URL and version
// get-chain-menu already uses and has proven works in this runtime -- so a problem loading it can only
// ever affect a PDF link, never an ordinary one, and never stop the function from booting at all.
async function textFromPdfBytes(bytes: ArrayBuffer): Promise<{ text: string } | { error: string }> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return { error: 'That PDF is too large to read (over 15MB).' };
  }
  try {
    const { extractText, getDocumentProxy } = await import('https://esm.sh/unpdf@1.8.1');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > MAX_PDF_PAGES) {
      return { error: `That PDF has too many pages to read (${pdf.numPages}, limit ${MAX_PDF_PAGES}).` };
    }
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PDF parse timed out')), PDF_PARSE_TIMEOUT_MS));
    const { text } = await Promise.race([extractText(pdf, { mergePages: true }), timeout]);
    return { text: String(text).slice(0, 12000) };
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[extract-menu-from-link] PDF parse error:', detail, e instanceof Error ? e.stack : '');
    return { error: "Couldn't read that PDF — it may be scanned, encrypted, or corrupted." };
  }
}

// A PDF menu link: fetched with the same SSRF-protected fetch used for an HTML page, its text pulled out
// with unpdf, then handed to extractItemsFromText below -- the exact same prompt, model, and JSON contract
// already used for a scraped HTML page and for the manual-paste "Update Menu Items From Text" box, so the
// LLM side of this needed no new code at all.
async function extractMenuFromPdfUrl(url: URL, restaurantName: string): Promise<ExtractResult> {
  let bytes: ArrayBuffer;
  try {
    const pdfRes = await safeFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PikMeMenuBot/1.0)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!pdfRes.ok) return { items: [], error: `Could not fetch that PDF (HTTP ${pdfRes.status}).` };
    bytes = await pdfRes.arrayBuffer();
  } catch (e) {
    console.error('[extract-menu-from-link] PDF fetch error:', e);
    return { items: [], error: 'Could not reach that PDF link. Check the URL and try again.' };
  }

  const parsed = await textFromPdfBytes(bytes);
  if ('error' in parsed) return { items: [], error: parsed.error };
  if (parsed.text.trim().length < 40) {
    return {
      items: [],
      error: "Couldn't find any real text in that PDF. It may be a scanned image rather than a real document — try Manual Entry instead.",
    };
  }
  return extractItemsFromText(parsed.text, restaurantName);
}

// A plain fetch of the page (server-rendered pages only).
async function extractMenuFromUrl(url: URL, restaurantName: string): Promise<ExtractResult> {
  let pageText = '';
  try {
    const pageRes = await safeFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PikMeMenuBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!pageRes.ok) return { items: [], error: `Could not fetch that link (HTTP ${pageRes.status}).` };
    const contentType = pageRes.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) {
      // Not caught by the .pdf-extension check up front (e.g. a link with no extension that happens to
      // serve a PDF) -- same text-extraction path, just discovered a step later and reusing the bytes
      // already fetched above instead of fetching a second time.
      const parsed = await textFromPdfBytes(await pageRes.arrayBuffer());
      if ('error' in parsed) return { items: [], error: parsed.error };
      if (parsed.text.trim().length < 40) {
        return {
          items: [],
          error: "Couldn't find any real text in that PDF. It may be a scanned image rather than a real document — try Manual Entry instead.",
        };
      }
      return extractItemsFromText(parsed.text, restaurantName);
    }
    const html = await pageRes.text();
    pageText = htmlToText(html).slice(0, 12000);
  } catch (e) {
    console.error('[extract-menu-from-link] Fetch error:', e);
    return { items: [], error: 'Could not reach that link. Check the URL and try again.' };
  }

  if (pageText.length >= 40) {
    const plainResult = await extractItemsFromText(pageText, restaurantName);
    if (plainResult.items.length > 0) return plainResult;
  }
  return {
    items: [],
    error:
      "Couldn't find any real menu items on that page. Make sure the link points directly to your menu " +
      '(not a locations, contact, or ordering page, and not a page that only shows a picture of the menu), ' +
      'or try Manual Entry instead.',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('Unauthorized', 401);

    const { restaurantId, restaurantName, menuUrl, force, items: providedItems } = await req.json();
    if (!restaurantId || !restaurantName?.trim() || !menuUrl?.trim()) {
      return err('restaurantId, restaurantName, and menuUrl are required', 400);
    }

    // Verify the caller actually owns this restaurant before touching its
    // menu — restaurantId comes straight from the client request body, so
    // without this check any authenticated owner could overwrite any other
    // restaurant's menu just by passing a different id.
    const token = authHeader.replace('Bearer ', '');
    const authedSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authedSupabase.auth.getUser(token);
    if (userError || !userData.user) return err('Unauthorized', 401);

    const serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: restaurant, error: restaurantError } = await serviceSupabase
      .from('restaurants')
      .select('owner_id, website_url')
      .eq('id', restaurantId)
      .single();
    if (restaurantError || !restaurant || restaurant.owner_id !== userData.user.id) {
      return err('Forbidden', 403);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(menuUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('not http(s)');
    } catch {
      return err('menuUrl must be a valid http(s) URL', 400);
    }
    const isPdfLink = parsedUrl.pathname.toLowerCase().endsWith('.pdf');

    // The PDF path fetches the URL itself (unlike the earlier Gemini-fetches-it design), so the SSRF
    // guard applies to it exactly like it does to an HTML link -- this protects OUR server, regardless
    // of what kind of file is on the other end.
    if (!(await isSafeUrl(parsedUrl))) {
      return err('That link points to a restricted address and cannot be used.', 400);
    }

    // Hard block: only accept a menu link on the restaurant's own website, as
    // set by the owner on their Restaurant Profile page. Note this is a
    // consistency check, not independent verification — website_url is
    // owner-provided, not sourced from Google, so this only guards against
    // pasting a link to an unrelated domain, not a dishonest owner who sets
    // both fields to match. No website_url on file means nothing to check
    // against, so those owners aren't domain-restricted (Manual Entry is the
    // safer path for a restaurant with no real web presence anyway). A PDF
    // menu is deliberately exempt from this one check -- restaurants commonly
    // host their PDF menu on a third-party site (a delivery platform, a PDF
    // host) rather than their own domain.
    if (restaurant.website_url && !isPdfLink) {
      let ownHostname: string;
      try {
        ownHostname = new URL(restaurant.website_url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        ownHostname = '';
      }
      const submittedHostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
      const isSameOrSubdomain =
        ownHostname !== '' &&
        (submittedHostname === ownHostname || submittedHostname.endsWith('.' + ownHostname));
      if (!isSameOrSubdomain) {
        return err(
          `This link must be on your restaurant's own website (${ownHostname}). ` +
          'Use Manual Entry if your menu is hosted elsewhere.',
          400
        );
      }
    }

    // Reuse items from a prior call on this same link instead of re-fetching
    // and re-running extraction — a force:true retry (after a coupon-orphan
    // confirmation) re-running the fetch/scrape + LLM step is both wasteful
    // and non-deterministic, so it could legitimately come back with
    // fewer/zero items on a second pass right after the owner just
    // confirmed they wanted to proceed.
    let items: unknown[];
    if (Array.isArray(providedItems) && providedItems.length > 0) {
      items = providedItems;
    } else {
      const extracted = isPdfLink
        ? await extractMenuFromPdfUrl(parsedUrl, restaurantName)
        : await extractMenuFromUrl(parsedUrl, restaurantName);
      if (extracted.items.length === 0) {
        return err(extracted.error || 'Could not extract a menu from that link.', 400);
      }
      items = extracted.items;
    }

    // ── Hand off to the shared replace function — it owns the coupon-orphan
    // check and the actual delete-then-upsert, so this stays in sync with
    // every other path that replaces a restaurant's real menu data. ────────
    const replaceRes = await fetch(`${Deno.env.get('SUPABASE_URL')!}/functions/v1/replace-restaurant-menu-items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
      },
      body: JSON.stringify({ restaurantId, restaurantName, items, menuUrl, force: !!force }),
    });
    const replaceData = await replaceRes.json();
    if (!replaceRes.ok) {
      return err(replaceData.error || 'Failed to save the extracted menu', replaceRes.status);
    }

    console.log('[extract-menu-from-link] Extracted', items.length, 'real items for', restaurantName);
    return ok(replaceData.requiresConfirmation ? { ...replaceData, items } : replaceData);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    console.error('[extract-menu-from-link] Unhandled error:', e);
    return err(message);
  }
});

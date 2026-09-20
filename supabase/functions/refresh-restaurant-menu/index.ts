import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── SSRF guard + real-page extraction ────────────────────────────────────────
// Duplicated from extract-menu-from-link rather than shared via a _shared/
// import — this self-hosted instance deploys each function folder
// independently and does not bundle a shared directory alongside them, so
// cross-function imports fail at boot ("Module not found .../_shared/...")
// even though that's a normal pattern on Supabase's hosted platform. Keep
// both copies in sync if this logic changes.

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

async function deterministicLinkId(restaurantName: string, itemName: string): Promise<string> {
  const text = `${restaurantName}::${itemName}::link`.toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return 'link_' + hex.slice(0, 24);
}

// ── JS-rendering fallback (ScrapingBee) ──────────────────────────────────────
// Plain fetch() never runs a page's JavaScript, so JS-rendered sites come
// back nearly empty (confirmed on real examples). Only called when the
// plain-fetch attempt below finds nothing, so normal server-rendered pages
// never touch this and cost stays near zero. Requires the optional
// SCRAPINGBEE_API_KEY secret — silently skipped if that isn't configured.
function maskKey(k: string): string {
  if (k.length <= 10) return '*'.repeat(k.length);
  return `${k.slice(0, 6)}...${k.slice(-4)} (len ${k.length})`;
}

// TEMP DEBUG — remove once SCRAPINGBEE_API_KEY is confirmed reaching the
// container correctly. Logs the request shape with the key masked (not the
// raw value) so this is safe to leave in briefly, but still delete once
// diagnosed rather than leaving it long-term.
async function fetchRenderedHtml(url: URL): Promise<string | null> {
  const apiKey = Deno.env.get('SCRAPINGBEE_API_KEY');
  console.log('[refresh-restaurant-menu] [scrapingbee-debug] SCRAPINGBEE_API_KEY present:', !!apiKey, apiKey ? maskKey(apiKey) : '(unset)');
  if (!apiKey) return null;
  try {
    const beeUrl = new URL('https://app.scrapingbee.com/api/v1/');
    beeUrl.searchParams.set('api_key', apiKey);
    beeUrl.searchParams.set('url', url.toString());
    beeUrl.searchParams.set('render_js', 'true');
    const templateUrl = beeUrl.toString().replace(apiKey, 'YOUR_API_KEY_HERE');
    console.log(
      '[refresh-restaurant-menu] [scrapingbee-debug] curl equivalent (paste your real key in place of YOUR_API_KEY_HERE — ' +
      `container's key is ${maskKey(apiKey)}, compare against what you tested locally):\n` +
      `curl "${templateUrl}"`
    );
    const res = await fetch(beeUrl.toString(), { signal: AbortSignal.timeout(30000) });
    console.log('[refresh-restaurant-menu] [scrapingbee-debug] Response status:', res.status, 'headers:', JSON.stringify(Object.fromEntries(res.headers.entries())));
    if (!res.ok) {
      console.warn('[refresh-restaurant-menu] ScrapingBee request failed:', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    return await res.text();
  } catch (e) {
    console.warn('[refresh-restaurant-menu] ScrapingBee fetch error:', e);
    return null;
  }
}

interface ExtractResult {
  items: unknown[];
  error?: string;
}

// Sends real page text to the LLM and asks it to EXTRACT, not invent.
async function extractItemsFromText(pageText: string, restaurantName: string): Promise<ExtractResult> {
  const AI_PROVIDER = Deno.env.get('AI_PROVIDER') ?? 'claude';
  const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-haiku-4-5-20251001';
  const QUICKSILVER_MODEL = Deno.env.get('QUICKSILVER_MODEL') ?? 'deepseek-v4-flash';

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
          max_tokens: 2048,
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
      if (e instanceof Error && e.name === 'AbortError') return { items: [], error: 'Quicksilver timed out' };
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
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[refresh-restaurant-menu] Claude error:', res.status, body);
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
    const match = cleaned.match(/\[[\s\S]*\]/);
    try {
      rawItems = match ? JSON.parse(match[0]) : [];
      if (!Array.isArray(rawItems)) throw new Error('Extracted content is not an array');
    } catch (e2) {
      console.error('[refresh-restaurant-menu] JSON parse failed:', e2, 'raw:', rawText.slice(0, 500));
      return { items: [], error: 'Could not parse a menu from that page' };
    }
  }

  const items = await Promise.all(
    (rawItems as Record<string, unknown>[])
      .filter((i) => i.name && typeof i.calories === 'number' && (i.calories as number) > 0)
      .map(async (i) => ({
        itemId: await deterministicLinkId(restaurantName, String(i.name)),
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

// Plain fetch first (free); only falls back to ScrapingBee's JS-rendered
// fetch if that finds nothing, so cost stays near zero for the (common)
// case of server-rendered pages. Never throws for "didn't find a menu here"
// — the caller just tries the next candidate URL.
async function extractMenuFromUrl(url: URL, restaurantName: string): Promise<ExtractResult> {
  if (url.pathname.toLowerCase().endsWith('.pdf')) {
    return { items: [], error: 'PDF not supported' };
  }
  if (!(await isSafeUrl(url))) {
    return { items: [], error: 'Restricted address' };
  }

  let pageText = '';
  try {
    const pageRes = await safeFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PikMeMenuBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (pageRes.ok) {
      const contentType = pageRes.headers.get('content-type') || '';
      if (!contentType.includes('application/pdf')) {
        const html = await pageRes.text();
        pageText = htmlToText(html).slice(0, 12000);
      }
    }
  } catch (e) {
    console.warn('[refresh-restaurant-menu] Plain fetch failed, trying JS-rendered fetch:', e);
  }

  console.log('[refresh-restaurant-menu] Scraped', pageText.length, 'chars of text from', url.toString());

  if (pageText.length >= 40) {
    const plainResult = await extractItemsFromText(pageText, restaurantName);
    if (plainResult.items.length > 0) return plainResult;
    console.log('[refresh-restaurant-menu] Plain fetch from', url.toString(), 'found nothing, trying JS-rendered fetch...');
  } else {
    console.log('[refresh-restaurant-menu] Plain fetch from', url.toString(), 'got too little text, trying JS-rendered fetch...');
  }

  const renderedHtml = await fetchRenderedHtml(url);
  if (!renderedHtml) {
    return { items: [], error: 'No real items found (JS-rendering fallback unavailable or also found nothing)' };
  }
  const renderedText = htmlToText(renderedHtml).slice(0, 12000);
  console.log('[refresh-restaurant-menu] JS-rendered fetch got', renderedText.length, 'chars from', url.toString());
  if (renderedText.length < 40) {
    return { items: [], error: 'No readable text even after JS rendering' };
  }
  return await extractItemsFromText(renderedText, restaurantName);
}

// Owner-triggered "Refresh with AI". When the restaurant has a known menu
// page or website (set by the owner on their Restaurant Profile page), this
// first tries to actually extract real items from it — same hardened
// pipeline as the explicit "Upload Menu" flow (plain fetch, then a
// JS-rendered fetch via ScrapingBee if that finds nothing), just triggered
// automatically instead of requiring the owner to paste a URL. Only falls
// back to pure AI-guessed items (fetch-menu-items-ai, no real data
// grounding at all) if neither is set, or extraction from both finds
// nothing real.
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { restaurantId, restaurantName, force, onlyUnverified } = await req.json();

    if (!restaurantId || !restaurantName) {
      return new Response(
        JSON.stringify({ error: "restaurantId and restaurantName required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify the caller actually owns this restaurant before touching its
    // menu — restaurantId comes straight from the client request body, so
    // without this check any authenticated owner could overwrite any other
    // restaurant's menu just by passing a different id.
    const token = authHeader.replace("Bearer ", "");
    const authedSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authedSupabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: restaurant, error: restaurantError } = await serviceSupabase
      .from("restaurants")
      .select("owner_id, website_url, menu_link")
      .eq("id", restaurantId)
      .single();
    if (restaurantError || !restaurant || restaurant.owner_id !== userData.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    let items: unknown[] | null = null;
    let usedRealWebsite = false;

    // Try the owner-specified menu page first (most likely to actually have
    // the menu on it), then the bare homepage as a fallback candidate.
    const candidateUrls = [restaurant.menu_link, restaurant.website_url].filter(
      (u): u is string => !!u
    );
    for (const candidate of candidateUrls) {
      try {
        const candidateUrl = new URL(candidate);
        const extracted = await extractMenuFromUrl(candidateUrl, restaurantName);
        if (extracted.items.length > 0) {
          items = extracted.items;
          usedRealWebsite = true;
          console.log(
            "[refresh-restaurant-menu] Auto-extracted", extracted.items.length,
            "real items from", candidateUrl.toString(), "for", restaurantName
          );
          break;
        }
        console.log(
          "[refresh-restaurant-menu] Auto-extraction from", candidateUrl.toString(),
          "found nothing (", extracted.error, ") — trying next candidate"
        );
      } catch (e) {
        console.warn("[refresh-restaurant-menu] Auto-extraction attempt failed, trying next candidate:", e);
      }
    }

    if (!items) {
      const menuResponse = await fetch(
        `${SUPABASE_URL}/functions/v1/fetch-menu-items-ai`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ restaurantName }),
        }
      );

      if (!menuResponse.ok) {
        const errorBody = await menuResponse.json();
        throw new Error(errorBody.error || "Failed to fetch menu items");
      }

      items = await menuResponse.json();
    }

    const replaceResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/replace-restaurant-menu-items`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          restaurantId,
          restaurantName,
          items,
          force: !!force,
          scope: onlyUnverified ? "unverified_only" : "all",
        }),
      }
    );
    const replaceData = await replaceResponse.json();
    if (!replaceResponse.ok) {
      throw new Error(replaceData.error || "Failed to save refreshed menu items");
    }

    return new Response(JSON.stringify({ ...replaceData, usedRealWebsite }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[refresh-restaurant-menu] Error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

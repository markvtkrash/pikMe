// Pure helpers for get-chain-menu. No Deno/network imports so they can be unit
// tested from the admin Jest suite (see admin/src/utils/chainMenuUtils.test.ts),
// the same way passwordRules.ts is.

export const DEFAULT_REFRESH_DAYS = 30;
export const MAX_REFRESH_DAYS = 365;
// Fewer extracted items than this is treated as "not really a menu".
export const MIN_MENU_ITEMS = 5;
export const MAX_MENU_ITEMS = 150;

// ── Page text ───────────────────────────────────────────────────────────────
// Crude but dependency-free HTML -> visible text. Block-level tags become
// newlines so the output stays one row per line, which is the main signal for
// where one menu item ends and the next begins. td/th are deliberately excluded
// (cells within one row).
const BLOCK_TAGS =
  'div|p|li|tr|h[1-6]|section|article|header|footer|nav|ul|ol|table|thead|tbody|dd|dt|dl|blockquote|br|hr';
const BLOCK_TAG_BOUNDARY = new RegExp(`</?(?:${BLOCK_TAGS})[^>]*>`, 'gi');

export function htmlToText(html: string): string {
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

// Many menu pages (Next.js and similar) render the menu from JSON embedded in a
// <script> tag, so the visible text is just navigation and footer. Collect the
// "name"-like strings from that JSON (the __NEXT_DATA__ blob and any JSON-LD)
// so the model has something to read. The list is noisy by design (categories,
// images and nav links also have names); the model filters it.
const NAME_KEYS = new Set(['name', 'title', 'productname', 'displayname', 'itemname', 'menuitemname', 'product_name']);
const MAX_JSON_BYTES = 3_000_000;
const MAX_JSON_NODES = 200_000;
const MAX_JSON_DEPTH = 14;

function collectNames(root: unknown, out: Set<string>, max: number) {
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length > 0 && out.size < max && visited < MAX_JSON_NODES) {
    const { value, depth } = stack.pop()!;
    visited++;
    if (Array.isArray(value)) {
      if (depth < MAX_JSON_DEPTH) for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], depth: depth + 1 });
    } else if (value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'string') {
          if (NAME_KEYS.has(key.toLowerCase())) {
            const s = v.replace(/\s+/g, ' ').trim();
            const isSlug = /^[a-z0-9]+([_-][a-z0-9]+)+$/.test(s);
            if (s.length >= 2 && s.length <= 80 && /[a-z]/i.test(s) && !isSlug && !/https?:|[{}<>]/.test(s)) out.add(s);
          }
        } else if (v && typeof v === 'object' && depth < MAX_JSON_DEPTH) {
          stack.push({ value: v, depth: depth + 1 });
        }
      }
    }
  }
}

export function extractJsonNameCandidates(html: string, max = 600): string[] {
  const out = new Set<string>();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.size < max) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    const isData = /id=["']__NEXT_DATA__["']/i.test(attrs) || /type=["']application\/ld\+json["']/i.test(attrs);
    if (!isData || body.length === 0 || body.length > MAX_JSON_BYTES) continue;
    try {
      collectNames(JSON.parse(body), out, max);
    } catch {
      // not valid JSON: ignore this block
    }
  }
  return Array.from(out);
}

// What the model reads for a page: its visible text, plus (when the page embeds
// JSON data) the names found there. The visible part is shortened when there is
// embedded data so both fit.
export function buildMenuPageText(html: string, limit = 15000): string {
  const candidates = extractJsonNameCandidates(html);
  if (candidates.length === 0) return htmlToText(html).slice(0, limit);
  const dataText = candidates.join('\n').slice(0, Math.floor(limit * 0.6));
  const visible = htmlToText(html).slice(0, limit - dataText.length - 120);
  return `${visible}\n\nNAMES FOUND IN THE PAGE'S EMBEDDED DATA (may include non-menu names such as categories or links):\n${dataText}`;
}

// Same rule as the SQL menu_source_is_stale(): missing / non-numeric / <= 0
// falls back to 30 (0 must never mean "always refresh"), capped at 365.
export function normalizeRefreshDays(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(n) || n <= 0) {
    return DEFAULT_REFRESH_DAYS;
  }
  return Math.min(Math.floor(n) || DEFAULT_REFRESH_DAYS, MAX_REFRESH_DAYS);
}

export const DEFAULT_MAX_ITEMS = 40;

// How many dish names to keep per chain (the chainMenuMaxItems setting). Missing
// or non-numeric falls back to 40. Clamped to MIN_MENU_ITEMS..MAX_MENU_ITEMS: a
// cap below the minimum could never produce a usable menu, and above the maximum
// the run risks the edge runtime's time limit.
export function normalizeMaxItems(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(n)) return DEFAULT_MAX_ITEMS;
  return Math.min(Math.max(Math.floor(n), MIN_MENU_ITEMS), MAX_MENU_ITEMS);
}

// A failed lookup (SerpApi down, timeout) shouldn't block the chain for the
// whole refresh period. The staleness rule only looks at fetched_at, so for an
// error we backdate it so the row becomes stale again after `retryHours`.
export function fetchedAtForRetry(now: Date, refreshDays: number, retryHours = 6): Date {
  const days = normalizeRefreshDays(refreshDays);
  const when = new Date(now.getTime() - days * 86_400_000 + retryHours * 3_600_000);
  return when > now ? now : when;
}

// ── Menu link cleaning ──────────────────────────────────────────────────────
const TRACKING_PARAMS = new Set([
  'gclid', 'fbclid', 'msclkid', 'ref', 'y_source', 'olonwp', 'cid', 'mc_cid', 'mc_eid',
]);
// Parameters that pick one store rather than describe the menu page.
const STORE_PARAMS = new Set(['store', 'storeid', 'store_id', 'unitnum', 'unit', 'location', 'locationid']);

export interface CleanedLink {
  menuLink: string;   // tracking and store parameters removed
  storeRef: string;   // e.g. "store=034416" ('' when none)
  source: string;     // host without www, e.g. "tacobell.com"
}

export function cleanMenuLink(raw: unknown): CleanedLink | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const keep = new URLSearchParams();
  const store = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    const k = key.toLowerCase();
    if (k.startsWith('utm_') || TRACKING_PARAMS.has(k)) continue;
    if (STORE_PARAMS.has(k)) store.append(key, value);
    else keep.append(key, value);
  }
  url.search = keep.toString();
  url.hash = '';
  return {
    menuLink: url.toString(),
    storeRef: store.toString(),
    source: url.hostname.toLowerCase().replace(/^www\./, ''),
  };
}

// The address actually fetched: the cleaned link plus the store parameters (some
// sites, e.g. Whataburger, need one to show a menu at all).
export function fetchUrlFor(menuLink: string, storeRef: string): string {
  if (!storeRef) return menuLink;
  return menuLink + (menuLink.includes('?') ? '&' : '?') + storeRef;
}

// ── Highlights (SerpApi's crowd-sourced dish tags) ──────────────────────────
const GENERIC_HIGHLIGHTS = new Set([
  'sauce', 'sauces', 'drink', 'drinks', 'food', 'menu', 'dessert', 'desserts', 'meal', 'meals',
  'large drink', 'small drink', 'medium drink', 'fountain drink', 'combo', 'side', 'sides',
]);

export function filterHighlightTitles(titles: unknown, max = 40): string[] {
  if (!Array.isArray(titles)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of titles) {
    if (typeof t !== 'string') continue;
    const title = t.replace(/\s+/g, ' ').trim();
    const key = title.toLowerCase();
    if (title.length < 2 || title.length > 60 || GENERIC_HIGHLIGHTS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= max) break;
  }
  return out;
}

// ── Extracted item names ────────────────────────────────────────────────────
const NON_ITEM_NAMES = new Set([
  'menu', 'order now', 'order online', 'order', 'cart', 'sign in', 'log in', 'login', 'sign up',
  'rewards', 'locations', 'find a location', 'catering', 'gift cards', 'careers', 'contact us',
  'about us', 'nutrition', 'allergens', 'privacy policy', 'terms of use', 'terms and conditions',
  'start order', 'view menu', 'skip to content', 'home', 'search',
]);

// True for text that is code or a file reference, not a dish: a path ("customer-stories/logos/cafe"), a file name
// ("menu.png"), an address, or a slug (all lowercase words joined by - or _, with no spaces: "orange-right-arrow").
// Page data carries lots of these; real menu names have spaces and capitals. A name that starts with a digit
// ("7-up") is not treated as a slug.
export function looksLikeCodeName(name: string): boolean {
  const t = String(name ?? '').trim();
  if (!t) return false;
  if (/[\\/]/.test(t)) return true;
  if (/\.(png|jpe?g|gif|webp|svg|css|js|json|ico|mp4|pdf)$/i.test(t)) return true;
  if (/^(https?:\/\/|www\.)/i.test(t)) return true;
  if (/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+$/.test(t)) return true;
  return false;
}

// Cleans the names the model returned: trims, drops price/calorie fragments and
// site furniture, de-duplicates, caps the list. Returns real-looking item names only.
export function sanitizeItemNames(raw: unknown, max = MAX_MENU_ITEMS): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const source = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' ? (entry as any).name : '');
    if (typeof source !== 'string') continue;
    const name = source
      .replace(/\$\s?\d+(\.\d{2})?/g, '')                 // prices
      .replace(/\b\d{2,4}\s?(cal|calories)\b\.?/gi, '')   // calories
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–—•*·.,:;]+|[\s\-–—•*·.,:;]+$/g, '')
      .trim();
    const key = name.toLowerCase();
    if (name.length < 2 || name.length > 80) continue;
    if (!/[a-z]/i.test(name)) continue;
    if (looksLikeCodeName(name)) continue;
    if (NON_ITEM_NAMES.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

// ── Model output parsing ────────────────────────────────────────────────────
// Strips code fences and, if the model wrapped the array in prose, pulls out the
// first [...] block. Returns null when nothing array-shaped can be parsed.
export function parseJsonArray(raw: string): unknown[] | null {
  const cleaned = (raw ?? '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to the substring attempt
  }
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// A place's website is only worth reading as a menu when its address looks like
// a menu or ordering page. A store-locator page ("/ks/olathe/15109-w-151st-st") has
// plenty of names on it but no menu, and reading it produces a junk menu.
export function isMenuLikeUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    return /(^|[\/_-])(menu|menus|order|food|eat)([\/_.-]|$)/i.test(url.pathname) ||
      /^(order|menu|menus)\./i.test(url.hostname);
  } catch {
    return false;
  }
}

// ── What to store after a SerpApi lookup, and where to read the menu from ───
// Pulled out of the edge function so the rules that once lost a good link are
// covered by tests.

export interface LookupResult {
  cleaned: CleanedLink | null;   // the menu link SerpApi returned, cleaned (null = none)
  website: CleanedLink | null;
  types: string[];
  highlights: string[];
}

// Fields to write to the source row. A lookup that returned nothing for a field
// must NOT blank what we stored before (SerpApi's menu block comes and goes for
// the same place), so empty values are left out of the update entirely.
export function buildSourceRecord(lookup: LookupResult): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  if (lookup.cleaned) {
    record.menu_link = lookup.cleaned.menuLink;
    record.store_ref = lookup.cleaned.storeRef || null;
    record.menu_source = lookup.cleaned.source;
  }
  if (lookup.website) record.website = lookup.website.menuLink;
  if (lookup.types.length > 0) record.place_types = lookup.types;
  if (lookup.highlights.length > 0) record.highlights = lookup.highlights;
  return record;
}

export interface CandidateInput {
  cleaned: CleanedLink | null;
  website: CleanedLink | null;
  storedLink: string | null | undefined;
  storedRef: string | null | undefined;
}

// Addresses to try reading the menu from, best first:
//  1. the link SerpApi just returned,
//  2. the link stored from an earlier lookup,
//  3. the place's website, only when it looks like a menu/ordering page (a
//     store-locator page yields a junk "menu").
export function pickMenuCandidates(input: CandidateInput): string[] {
  if (input.cleaned) return [fetchUrlFor(input.cleaned.menuLink, input.cleaned.storeRef)];
  if (input.storedLink) return [fetchUrlFor(input.storedLink, input.storedRef ?? '')];
  if (input.website && isMenuLikeUrl(input.website.menuLink)) return [input.website.menuLink];
  return [];
}

// ── Where to read the menu when SerpApi gave no link ────────────────────────
// Sites that are not worth guessing paths on (social, delivery and listing sites).
const NO_GUESS_HOSTS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'yelp.com',
  'tripadvisor.com', 'ubereats.com', 'doordash.com', 'grubhub.com', 'google.com', 'linktr.ee',
];
const GUESS_PATHS = ['/menu', '/menus', '/our-menu'];
// A store-locator subdomain is not where the chain's menu lives; the main site is.
const LOCATOR_PREFIX = /^(locations?|stores?|find|restaurants?)\./i;

// Likely menu addresses on a store's own website, in order of how common they are. Used only
// when neither Google nor the built-in list gave a menu page. Empty for social, delivery and
// listing sites, and for anything that is not a normal web address.
export function guessMenuUrls(websiteUrl: unknown, max = GUESS_PATHS.length): string[] {
  if (typeof websiteUrl !== 'string') return [];
  let url: URL;
  try {
    url = new URL(websiteUrl);
  } catch {
    return [];
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
  let host = url.hostname.toLowerCase();
  const bare = host.replace(/^www\./, '');
  if (NO_GUESS_HOSTS.some((h) => bare === h || bare.endsWith(`.${h}`))) return [];
  if (LOCATOR_PREFIX.test(host)) host = 'www.' + host.replace(LOCATOR_PREFIX, '');
  const origin = `${url.protocol}//${host}`;
  return GUESS_PATHS.slice(0, Math.max(0, max)).map((path) => origin + path);
}

export interface MenuCandidate {
  url: string;
  guess: boolean;   // a guessed address (remembered as such when it works)
}

// Every address worth trying for the menu, best first:
//  1. the link SerpApi just returned, else the link stored earlier (a manual link ends up here),
//  2. otherwise: the chain's built-in menu page, the place's website when it already looks like a
//     menu page, then guessed menu paths on the website.
export function buildCandidateList(input: {
  cleaned: CleanedLink | null;
  storedLink?: string | null;
  storedRef?: string | null;
  directoryLink?: string | null;
  website: CleanedLink | null;
}): MenuCandidate[] {
  if (input.cleaned) return [{ url: fetchUrlFor(input.cleaned.menuLink, input.cleaned.storeRef), guess: false }];
  if (input.storedLink) return [{ url: fetchUrlFor(input.storedLink, input.storedRef ?? ''), guess: false }];

  const out: MenuCandidate[] = [];
  const add = (url: string, guess: boolean) => {
    if (!out.some((c) => c.url === url)) out.push({ url, guess });
  };
  const directory = cleanMenuLink(input.directoryLink);
  if (directory) add(fetchUrlFor(directory.menuLink, directory.storeRef), false);
  if (input.website) {
    if (isMenuLikeUrl(input.website.menuLink)) add(input.website.menuLink, false);
    for (const guessed of guessMenuUrls(input.website.menuLink)) add(guessed, true);
  }
  return out;
}

// ── Fallback: Google's dish list ────────────────────────────────────────────
// Some chains' menu pages can't be read (they block automated visitors or need a
// browser), yet SerpApi lists dish names for the store (crowd-sourced photo tags).
// When the page gave nothing, those names can seed a smaller menu, with AI-estimated
// nutrition. Fewer than this many usable names is not worth building a menu from.
export const MIN_FALLBACK_ITEMS = 8;

// Marks a menu built that way (stored as the lookup's status detail, and shown to admins).
export const FALLBACK_NOTE = "Built from Google's popular-dish list because the menu page could not be read";

export function pickFallbackNames(highlights: unknown, max = MAX_MENU_ITEMS): string[] {
  const names = sanitizeItemNames(filterHighlightTitles(highlights, max), max);
  return names.length >= MIN_FALLBACK_ITEMS ? names : [];
}

// A refresh should not replace a good menu with a much smaller one (a page that
// changed, a blocked or half-rendered page, a locator page). Compares with what
// the previous run kept, allowing for the admin lowering the item cap since.
export const MIN_RETAINED_FRACTION = 0.5;

export function shouldKeepPreviousMenu(previousCount: number, newCount: number, maxItems: number): boolean {
  if (!Number.isFinite(previousCount) || previousCount < MIN_MENU_ITEMS) return false;
  const expected = Math.min(previousCount, Math.max(maxItems, MIN_MENU_ITEMS));
  return newCount < expected * MIN_RETAINED_FRACTION;
}

// ── Deciding whether to run a lookup, and which place to look up ────────────
export const PENDING_STALE_MS = 10 * 60 * 1000;

export interface RunDecisionInput {
  force: boolean;          // an admin asked for a pull now (ignores the refresh period)
  stale: boolean;          // menu_source_is_stale() for the stored fetched_at
  status: string;          // stored status
  updatedAgeMs: number;    // time since the row was last updated
}

// A normal request runs a lookup when the stored one is stale, or a claimed
// lookup has been stuck for over 10 minutes. An admin's forced pull ignores the
// refresh period but still never runs on top of a lookup that is in flight. "In
// flight" = pending AND recently fetched AND recently updated: an admin who has
// just saved a manual link also leaves the row pending, but with an old
// fetched_at (marked due), so that must NOT block the pull.
export function shouldRunLookup(input: RunDecisionInput): boolean {
  const pending = input.status === 'pending';
  const inFlight = pending && !input.stale && input.updatedAgeMs <= PENDING_STALE_MS;
  if (input.force) return !inFlight;
  return input.stale || (pending && input.updatedAgeMs > PENDING_STALE_MS);
}

const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

export function isValidPlaceId(value: unknown): value is string {
  return typeof value === 'string' && PLACE_ID_PATTERN.test(value);
}

// Which Google place ID to look up: the one in the request, else the one stored
// from an earlier lookup, else any cached store of the chain. A chain with a
// manual menu link needs none (SerpApi is skipped), so null is acceptable there.
export function resolvePlaceId(input: {
  bodyPlaceId?: unknown;
  storedPlaceId?: unknown;
  cachedPlaceId?: unknown;
}): string | null {
  for (const candidate of [input.bodyPlaceId, input.storedPlaceId, input.cachedPlaceId]) {
    if (isValidPlaceId(candidate)) return candidate;
  }
  return null;
}

// True when a provider's 400 message says a request field is not supported (for
// example Quicksilver's "Unsupported request field(s): chat_template_kwargs"), as
// opposed to some other 400 such as a bad model name or an over-long prompt.
export function isUnsupportedFieldError(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  return /unsupported[_ ]?(request[_ ])?(field|param)|unknown (field|parameter)|unrecognized (field|request argument|parameter)|extra inputs are not permitted/i
    .test(message);
}

// Network timeouts, dropped connections and provider 5xx/429 are worth one more
// try; bad keys or malformed requests are not.
export function isRetryableAiError(e: unknown): boolean {
  if (!e) return false;
  const name = (e as { name?: string }).name ?? '';
  const message = e instanceof Error ? e.message : String(e);
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  if (/timed out|timeout|network|connection|fetch failed|reset|refused/i.test(message)) return true;
  const status = message.match(/\b(?:error|returned)\s+(\d{3})\b/i);
  if (status) {
    const code = Number(status[1]);
    return code === 429 || code >= 500;
  }
  return false;
}

// Qwen 3 models reason before answering unless told not to; for a plain
// extraction that is minutes of wasted time. "/no_think" is Qwen 3's documented
// soft switch. Added only for Qwen 3 models and only once.
export function withNoThink(prompt: string, model: string): string {
  if (!/qwen\s*-?\s*3/i.test(model ?? '')) return prompt;
  if (/\/no_think\s*$/.test(prompt)) return prompt;
  return `${prompt}\n\n/no_think`;
}

// Extra request fields for the chain-menu AI model, set by an admin as
// semicolon-separated name=value pairs (the chainMenuModelParams setting), e.g.
//   reasoning.enabled=false;temperature=0.2
// A dot nests: reasoning.enabled=false is sent as {"reasoning":{"enabled":false}}.
// Values: true/false -> boolean, numbers -> number, null -> null, otherwise text
// (optional surrounding quotes are removed). Malformed pairs are skipped, and the
// fields the function sets itself can never be overridden from here.
const RESERVED_BODY_KEYS = new Set(['model', 'messages', 'max_tokens', 'stream', 'n']);
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function parseParamValue(raw: string): unknown {
  const lower = raw.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  const quoted = raw.match(/^(["'])(.*)\1$/);
  return quoted ? quoted[2] : raw;
}

export function parseModelParams(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof raw !== 'string' || !raw.trim()) return out;

  for (const pair of raw.split(';')) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const valueText = trimmed.slice(eq + 1).trim();
    if (valueText === '') continue;

    const path = trimmed.slice(0, eq).split('.').map((segment) => segment.trim());
    if (path.some((segment) => !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(segment))) continue;
    if (RESERVED_BODY_KEYS.has(path[0].toLowerCase())) continue;
    if (path.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) continue;

    // Walk/create the nested objects; skip the pair if a parent is already a plain value.
    let target = out;
    let ok = true;
    for (let i = 0; i < path.length - 1; i++) {
      const existing = target[path[i]];
      if (existing === undefined) {
        const child: Record<string, unknown> = {};
        target[path[i]] = child;
        target = child;
      } else if (existing && typeof existing === 'object') {
        target = existing as Record<string, unknown>;
      } else {
        ok = false;
        break;
      }
    }
    if (ok) target[path[path.length - 1]] = parseParamValue(valueText);
  }
  return out;
}

// Some servers return the reasoning inline as <think>...</think>. Remove it so
// brackets inside the reasoning can't be mistaken for the JSON array.
export function stripThinking(text: string): string {
  return (text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')   // reasoning closed without an opening tag
    .trim();
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── Nutrition ───────────────────────────────────────────────────────────────
export interface NutritionEstimate {
  calories: number;
  totalFat_g: number;
  saturatedFat_g: number;
  sodium_mg: number;
  totalCarbs_g: number;
  dietaryFiber_g: number;
  sugars_g: number;
  protein_g: number;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// Validates one model-estimated row. Rejects it (null) when calories aren't a
// plausible number, so a garbled estimate never becomes a menu item.
export function toNutrition(row: unknown): NutritionEstimate | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const calories = Math.round(num(r.calories));
  if (calories < 1 || calories > 5000) return null;
  return {
    calories,
    totalFat_g: Math.min(num(r.totalFat_g), 500),
    saturatedFat_g: Math.min(num(r.saturatedFat_g), 300),
    sodium_mg: Math.min(Math.round(num(r.sodium_mg)), 20000),
    totalCarbs_g: Math.min(num(r.totalCarbs_g), 800),
    dietaryFiber_g: Math.min(num(r.dietaryFiber_g), 200),
    sugars_g: Math.min(num(r.sugars_g), 500),
    protein_g: Math.min(num(r.protein_g), 300),
  };
}

// Pairs the model's estimates back to the names we asked about. Only names we
// sent are kept (the model can't add items), matched case-insensitively.
export function matchEstimates(
  names: string[],
  estimates: unknown[] | null,
): { name: string; nutrition: NutritionEstimate }[] {
  if (!estimates) return [];
  const byName = new Map<string, unknown>();
  for (const e of estimates) {
    const n = e && typeof e === 'object' ? (e as any).name : null;
    if (typeof n === 'string') byName.set(n.trim().toLowerCase(), e);
  }
  const out: { name: string; nutrition: NutritionEstimate }[] = [];
  for (const name of names) {
    const nutrition = toNutrition(byName.get(name.toLowerCase()));
    if (nutrition) out.push({ name, nutrition });
  }
  return out;
}

// ── The menu build queue (migration 101) ────────────────────────────────────
// What a lookup reports back to its queue job. The queue knows four outcomes; the lookup's other answers
// (still running, not a chain) are not outcomes, so the job is left as it is.
export type QueueResult = 'ok' | 'no_menu_link' | 'unreadable' | 'error';

export function mapResultToQueueStatus(status: string | null | undefined): QueueResult | null {
  switch (status) {
    case 'ok': return 'ok';
    case 'no_menu_link':
    case 'no_place_id':          // nothing to look up: the same as no menu link for the queue's purposes
      return 'no_menu_link';
    case 'unreadable': return 'unreadable';
    case 'error': return 'error';
    default: return null;
  }
}

// A queue job id from a request body: a positive whole number, else none.
export function parseJobId(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
}

// ── PDF menus ───────────────────────────────────────────────────────────────
// A menu link that is a PDF is read in memory (never saved): the file is checked for size, its text is
// extracted and fed to the same dish-listing step as a web page.
export const PDF_MAX_BYTES = 10 * 1024 * 1024;   // largest file that is downloaded
export const PDF_MAX_PAGES = 30;                 // a menu is a few pages; more is a catalogue or a guide

// Some menu links are not the file but a viewer page that shows it, such as
//   https://docs.google.com/viewerng/viewer?url=https://site.com/menu.pdf
//   https://view.officeapps.live.com/op/view.aspx?src=https%3A%2F%2Fsite.com%2Fmenu.docx
// The viewer page is a small web page that loads the file with JavaScript, so it has no menu text. This
// returns the address of the real file inside it (only for these viewers, and only an http(s) address);
// any other link comes back unchanged.
export function unwrapViewerUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const googleViewer = host === 'docs.google.com' && /^\/(viewerng\/viewer|viewer|gview)\/?$/i.test(u.pathname);
    const officeViewer = host === 'view.officeapps.live.com' && /^\/op\/(view|embed)\.aspx$/i.test(u.pathname);
    if (googleViewer || officeViewer) {
      const inner = u.searchParams.get(googleViewer ? 'url' : 'src');
      if (inner && /^https?:\/\/[^\s]+$/i.test(inner)) return inner;
    }
  } catch {
    // not a valid address: leave it for the caller to reject
  }
  return raw;
}

// The server says it is a PDF.
export function isPdfContentType(contentType: string | null | undefined): boolean {
  return /application\/(x-)?pdf/i.test(contentType ?? '');
}

// The address ends in .pdf (anything after a ? or # is ignored).
export function isPdfUrl(url: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// The file itself starts with "%PDF-" (some servers label a PDF as a generic download). Real files may
// have a few stray bytes before the marker, which readers accept, so the first 1024 bytes are searched.
export function looksLikePdfBytes(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true;
  }
  return false;
}

// Is it a PDF, going by the server's label, the address, or the file's own first bytes?
export function isPdfFile(input: { contentType?: string | null; url: string; bytes: Uint8Array }): boolean {
  return isPdfContentType(input.contentType) || isPdfUrl(input.url) || looksLikePdfBytes(input.bytes);
}

// Text extracted from a PDF, tidied for the dish-listing step: line breaks kept (a menu is line by line),
// runs of spaces and blank lines collapsed, cut to the same size limit as page text.
export function pdfTextToPageText(text: string, limit: number): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, Math.max(0, limit));
}

// Does this lookup skip Google (SerpApi)? A link an admin entered by hand is read as is. With no store
// known but a built-in menu page, that page is read directly. Anything else needs a store to ask Google
// about. 'none' means there is nothing to look up at all.
export type LookupSource = 'manual' | 'built_in' | 'serpapi' | 'none';

export function decideLookupSource(input: {
  manualLink: boolean;
  placeId: string | null;
  builtInPage: string | null;
}): LookupSource {
  if (input.manualLink) return 'manual';
  if (input.placeId) return 'serpapi';
  if (input.builtInPage && input.builtInPage.trim() !== '') return 'built_in';
  return 'none';
}

// True when the request carries the project's service key: the scheduled build job
// (run_chain_menu_builds, migration 087) calls the function that way. An empty or missing
// key never matches, so a blank "Bearer " header cannot pass as the service role.
export function isServiceRoleCall(authHeader: string | null | undefined, serviceKey: string | null | undefined): boolean {
  if (!serviceKey || serviceKey.length < 20) return false;
  return authHeader === `Bearer ${serviceKey}`;
}

// ── Text supplied by the browser worker (crawler/crawl_places.py, through the menu-crawl function) ──────────────
// The worker sends the menu text it read in a real browser. It is cleaned and capped here, split into pieces that
// each fit one AI call, and the dishes (with any calories the page itself states) are read from every piece.
export const SUPPLIED_TEXT_LIMIT = 60000;
export const SUPPLIED_CHUNK_SIZE = 12000;

// Plain text only: no control characters, no "SOURCE:" header lines the reader adds, no runs of blank lines, and at
// most `limit` characters (cut at a line boundary). Anything that is not a string becomes ''.
export function cleanSuppliedText(raw: unknown, limit = SUPPLIED_TEXT_LIMIT): string {
  if (typeof raw !== 'string') return '';
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !/^SOURCE:/i.test(l));
  const out: string[] = [];
  let size = 0;
  let blanks = 0;
  for (const line of lines) {
    if (line === '') {
      blanks++;
      if (blanks > 1 || out.length === 0) continue;
    } else {
      blanks = 0;
    }
    if (size + line.length + 1 > limit) break;
    out.push(line);
    size += line.length + 1;
  }
  return out.join('\n').trim();
}

// Splits text into pieces of at most `size` characters at line boundaries. A piece that starts in the middle of a
// section begins with that section's "## heading" line again, so the AI still knows what the items belong to.
export function chunkMenuText(text: string, size = SUPPLIED_CHUNK_SIZE): string[] {
  const lines = text.split('\n').map((l) => (l.length > size ? l.slice(0, size) : l));
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  let heading = '';
  for (const line of lines) {
    if (current.length > 0 && length + line.length + 1 > size) {
      chunks.push(current.join('\n').trim());
      current = heading && !line.startsWith('## ') ? [heading] : [];
      length = current.length ? heading.length + 1 : 0;
    }
    current.push(line);
    length += line.length + 1;
    if (line.startsWith('## ')) heading = line;
  }
  if (current.join('').trim()) chunks.push(current.join('\n').trim());
  return chunks.filter((c) => c.length > 0);
}

export interface Dish {
  name: string;
  // the calories the menu page itself states for this dish, or null (never an estimate)
  calories: number | null;
}

// Cleans the dishes the model listed: names through sanitizeItemNames (prices, calorie fragments, site furniture and
// duplicates removed), calories kept only when they are a plausible whole number from 1 to 5000.
export function sanitizeDishes(raw: unknown, max = MAX_MENU_ITEMS): Dish[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Dish[] = [];
  for (const entry of raw) {
    const nameSource = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' ? (entry as any).name : null);
    const [name] = sanitizeItemNames([nameSource], 1);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const c = entry && typeof entry === 'object' ? Number((entry as any).calories) : NaN;
    out.push({ name, calories: Number.isFinite(c) && c >= 1 && c <= 5000 ? Math.round(c) : null });
    if (out.length >= max) break;
  }
  return out;
}

// Joins the dishes read from several pieces of text: a dish seen twice is kept once, keeping stated calories if
// either copy had them.
export function mergeDishes(lists: Dish[][], max = MAX_MENU_ITEMS): Dish[] {
  const byName = new Map<string, Dish>();
  for (const list of lists) {
    for (const d of list) {
      const key = d.name.toLowerCase();
      const have = byName.get(key);
      if (!have) byName.set(key, { ...d });
      else if (have.calories === null && d.calories !== null) have.calories = d.calories;
    }
  }
  return Array.from(byName.values()).slice(0, max);
}

// The "- name" lines for the nutrition prompt; a dish whose calories the menu states carries them in parentheses.
export function nutritionItemLines(names: string[], listed?: Map<string, number> | null): string {
  return names
    .map((n) => {
      const c = listed?.get(n.toLowerCase());
      return c ? `- ${n} (calories listed on the menu: ${c})` : `- ${n}`;
    })
    .join('\n');
}

// ── AI call settings (app_config: menuNutritionBatchSize, menuAiTimeoutSeconds) ──────────────────────────────────
export const DEFAULT_NUTRITION_BATCH_SIZE = 10;
export const MIN_NUTRITION_BATCH_SIZE = 1;
export const MAX_NUTRITION_BATCH_SIZE = 50;
export const DEFAULT_AI_TIMEOUT_SECONDS = 30;
export const MIN_AI_TIMEOUT_SECONDS = 5;
export const MAX_AI_TIMEOUT_SECONDS = 120;
// A default self-hosted edge runtime ends a request after about a minute; later steps and retries stay inside this.
export const REQUEST_BUDGET_MS = 55000;

function firstWholeNumberInRange(candidates: unknown[], min: number, max: number): number | null {
  for (const raw of candidates) {
    const text = String(raw ?? '').trim();
    if (!/^[0-9]{1,6}$/.test(text)) continue;
    const n = Number(text);
    if (n >= min && n <= max) return n;
  }
  return null;
}

// How many dishes go to the AI in one nutrition call. Smaller batches finish sooner and fail less often.
// The first valid value (app_config, then the env var) wins; blank, non-numeric or out-of-range values are skipped.
export function parseNutritionBatchSize(...candidates: unknown[]): number {
  return firstWholeNumberInRange(candidates, MIN_NUTRITION_BATCH_SIZE, MAX_NUTRITION_BATCH_SIZE) ?? DEFAULT_NUTRITION_BATCH_SIZE;
}

// How long one AI call may take, in milliseconds (the setting is in seconds).
export function parseAiTimeoutMs(...candidates: unknown[]): number {
  const seconds = firstWholeNumberInRange(candidates, MIN_AI_TIMEOUT_SECONDS, MAX_AI_TIMEOUT_SECONDS);
  return (seconds ?? DEFAULT_AI_TIMEOUT_SECONDS) * 1000;
}

// A failed AI call is tried once more only if the retry could still finish inside the request budget:
// started at or before this many ms into the request. A long timeout leaves no room for a retry (0).
export function aiRetryCutoffMs(timeoutMs: number, budgetMs = REQUEST_BUDGET_MS): number {
  return Math.max(0, budgetMs - timeoutMs);
}

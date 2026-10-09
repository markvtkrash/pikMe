// Pure helpers for the admin "Franchise Menu Management" page: validating a hand-entered menu
// link, labelling a lookup outcome, filtering and summarising the list.

export interface ChainMenuSource {
  chain_id: string;
  chain_name: string;
  category: string | null;
  status: string;
  status_detail: string | null;
  menu_link: string | null;
  store_ref: string | null;
  menu_link_manual: boolean;
  website: string | null;
  item_count: number;
  fetched_at: string | null;
  current_items: number;
  // The chain's built-in fallback menu page (franchise_chains.menu_url, migration 084/085).
  built_in_menu_url: string | null;
  // The store (Google place ID) the lookup asks Google about, and whether ANY store of the chain is known
  // (migration 096). Absent before that migration is applied.
  source_place_id?: string | null;
  has_store?: boolean;
}

// A chain the scheduled job cannot build yet: no store of it has been seen, and there is neither a hand-set
// link nor a built-in menu page to read instead.
export function needsStore(source: Pick<ChainMenuSource, 'has_store' | 'menu_link_manual' | 'built_in_menu_url'>): boolean {
  return source.has_store === false && !source.menu_link_manual && !source.built_in_menu_url;
}

// The "miles" box next to the city or ZIP in the Store search: blank or not a number means 10, and the
// value is kept between 1 and 30 (Google's place search does not reach further than about 31 miles).
export const DEFAULT_STORE_SEARCH_MILES = 10;
export const MAX_STORE_SEARCH_MILES = 30;

export function parseSearchMiles(text: string): number {
  const n = Number(text.trim());
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_STORE_SEARCH_MILES;
  return Math.min(Math.max(Math.round(n), 1), MAX_STORE_SEARCH_MILES);
}

// Mirrors the place ID check in admin_set_chain_place_id (migration 096). Blank is allowed (it removes the store).
export function validatePlaceIdInput(value: string): string | null {
  const v = value.trim();
  if (v === '') return null;
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(v)) {
    return 'That does not look like a Google place ID (letters, numbers, - and _, 10 to 200 characters).';
  }
  return null;
}

// Mirrors the checks in admin_set_chain_menu_link (migration 078), for instant
// feedback. The database is the real gate.
export function validateMenuLinkInput(link: string, storeRef: string): string | null {
  const l = link.trim();
  const r = storeRef.trim();
  if (l === '') return null; // blank = clear the manual link, which is allowed
  if (l.length > 2000) return 'That link is too long';
  if (/\s/.test(l)) return 'The link must not contain spaces';
  if (!/^https?:\/\/[^/?#\s]+\.[^/?#\s]+/i.test(l)) {
    return 'Enter a full web address starting with http:// or https://';
  }
  if (r !== '' && (r.length > 200 || !/^[A-Za-z0-9_.=&%-]+$/.test(r))) {
    return 'The store parameter may only contain letters, numbers and _ . = & % -';
  }
  return null;
}

export type StatusTone = 'good' | 'warn' | 'bad' | 'neutral';

export function statusInfo(source: Pick<ChainMenuSource, 'status' | 'menu_link_manual'>): { label: string; tone: StatusTone } {
  switch (source.status) {
    case 'ok':
      return { label: source.menu_link_manual ? 'OK · manual link' : 'OK', tone: 'good' };
    case 'pending':
      return { label: 'Waiting for next lookup', tone: 'neutral' };
    case 'no_menu_link':
      return { label: 'No menu link found', tone: 'bad' };
    case 'unreadable':
      return { label: 'Page not readable', tone: 'bad' };
    case 'error':
      return { label: 'Lookup error', tone: 'bad' };
    case 'not_started':
      return { label: 'Not looked up yet', tone: 'neutral' };
    default:
      return { label: source.status, tone: 'neutral' };
  }
}

export type SourceFilter = 'all' | 'attention' | 'ok' | 'manual' | 'none' | 'due' | 'store';

const SOURCE_FILTERS: SourceFilter[] = ['all', 'attention', 'ok', 'manual', 'none', 'due', 'store'];

// A filter named in the page address (for example ?filter=attention from the Franchise Menu Issues report), else 'all'.
export function parseSourceFilter(value: unknown): SourceFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return SOURCE_FILTERS.includes(v as SourceFilter) ? (v as SourceFilter) : 'all';
}

// "Due for refresh" = a lookup exists but is old or was marked for a fresh one (the last-lookup date
// is over a year back; marking records 400 days). A chain never looked up is "Not looked up" instead.
export function isMarkedDue(source: Pick<ChainMenuSource, 'fetched_at'>, now: Date = new Date()): boolean {
  return !!source.fetched_at && isDueForLookup(source.fetched_at, now);
}

// "Needs attention" = a lookup was tried and found no usable menu.
export function needsAttention(source: Pick<ChainMenuSource, 'status'>): boolean {
  return source.status === 'no_menu_link' || source.status === 'unreadable' || source.status === 'error';
}

export function filterSources(rows: ChainMenuSource[], filter: SourceFilter, search: string): ChainMenuSource[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.chain_name.toLowerCase().includes(q) && !(r.category ?? '').toLowerCase().includes(q)) return false;
    switch (filter) {
      case 'attention': return needsAttention(r);
      case 'ok': return r.status === 'ok';
      case 'manual': return r.menu_link_manual;
      case 'none': return r.status === 'not_started';
      case 'due': return isMarkedDue(r);
      case 'store': return needsStore(r);
      default: return true;
    }
  });
}

export function summarizeSources(rows: ChainMenuSource[]) {
  return {
    total: rows.length,
    ok: rows.filter((r) => r.status === 'ok').length,
    attention: rows.filter(needsAttention).length,
    manual: rows.filter((r) => r.menu_link_manual).length,
    notStarted: rows.filter((r) => r.status === 'not_started').length,
    due: rows.filter((r) => isMarkedDue(r)).length,
    needsStore: rows.filter((r) => needsStore(r)).length,
  };
}

// "never", "today", "3 days ago". A 400-day-old value is how "check again" is
// recorded, so anything over a year reads as due rather than a misleading date.
export function formatChecked(fetchedAt: string | null, now: Date = new Date()): string {
  if (!fetchedAt) return 'never';
  const then = new Date(fetchedAt).getTime();
  if (!Number.isFinite(then)) return 'never';
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  if (days >= 365) return 'due for a new lookup';
  if (days <= 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// The "when was it last looked up" part of a row, with a tone so the page can colour it:
// 'due' (marked for a fresh lookup), 'never' (no lookup yet), 'fresh' (looked up recently).
export function describeCheckState(
  fetchedAt: string | null,
  now: Date = new Date(),
): { text: string; tone: 'due' | 'never' | 'fresh' } {
  if (!fetchedAt || !Number.isFinite(new Date(fetchedAt).getTime())) return { text: 'never looked up', tone: 'never' };
  if (isDueForLookup(fetchedAt, now)) return { text: 'due for a new lookup', tone: 'due' };
  return { text: `checked ${formatChecked(fetchedAt, now)}`, tone: 'fresh' };
}

// Plain-language outcome of a "Pull menu now", for the message shown to the admin.
export function describePullResult(
  result: { status?: string; itemCount?: number; chain?: string; message?: string } | null | undefined,
): { title: string; message: string; success: boolean } {
  const chain = result?.chain || 'this chain';
  switch (result?.status) {
    case 'ok':
      return { title: 'Menu built', message: `${result.itemCount ?? 0} items are now shown for ${chain}.`, success: true };
    case 'in_progress':
      return { title: 'Already running', message: `A lookup for ${chain} is already in progress. Check back in a minute.`, success: false };
    case 'no_menu_link':
      return { title: 'No menu link found', message: `Google lists no menu link for ${chain}. Enter its menu link by hand, then pull again.`, success: false };
    case 'unreadable':
      return { title: 'Page not readable', message: `A menu page was found for ${chain}, but its dish names could not be read. Try a different link, then pull again.`, success: false };
    case 'no_place_id':
      return { title: 'Nothing to look up', message: result.message || `No store of ${chain} has been seen yet. Enter a menu link by hand instead.`, success: false };
    case 'error':
      return { title: 'The lookup hit an error', message: "It will be retried automatically later. The reason is shown on the chain's row once you reopen it.", success: false };
    case 'not_a_chain':
      return { title: 'Not a chain', message: 'That name is not on the franchise list.', success: false };
    default:
      return { title: 'Finished', message: `The server answered "${result?.status ?? 'nothing'}".`, success: false };
  }
}

// Is this chain already due for a fresh lookup? (Never looked up, or its last lookup was
// marked old by "Look up again": formatChecked shows that as "due for a new lookup".)
export function isDueForLookup(fetchedAt: string | null, now: Date = new Date()): boolean {
  if (!fetchedAt) return true;
  const then = new Date(fetchedAt).getTime();
  if (!Number.isFinite(then)) return true;
  return Math.floor((now.getTime() - then) / 86_400_000) >= 365;
}

// What the page shows for a chain right after "Look up again" succeeds. Mirrors the database,
// which sets fetched_at to 400 days ago, so the row updates without reloading the whole list.
export function markedDueTimestamp(now: Date = new Date()): string {
  return new Date(now.getTime() - 400 * 86_400_000).toISOString();
}

// ── Scheduled builds panel (migrations 087-089) ─────────────────────────────
export interface ChainBuildStatus {
  cron_installed: boolean;
  job_scheduled: boolean;
  job_active: boolean;
  job_schedule: string | null;
  per_run: number;
  configured: boolean;
  queued_count: number;
  queued_names: string[];
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_detail: string | null;
  // Independent restaurants (migration 105): per-run limit, daily cap, and the queue counts.
  place_per_run?: number;
  place_per_day?: number;
  places_waiting?: number;
  places_attention?: number;
}

// Choices offered for "builds per run"; 0 pauses the job.
export const BUILDS_PER_RUN_OPTIONS = [0, 1, 3, 5, 10];

// Choices offered for the daily cap on independent-restaurant builds; 0 pauses them.
export const PLACE_PER_DAY_OPTIONS = [0, 25, 50, 100, 200];

// "7 * * * *" -> "hourly at :07"; anything else is shown as written.
export function describeSchedule(schedule: string | null | undefined): string {
  if (!schedule) return 'not scheduled';
  const m = /^(\d{1,2}) \* \* \* \*$/.exec(schedule.trim());
  if (m) return `hourly at :${m[1].padStart(2, '0')}`;
  const two = /^(\d{1,2}),(\d{1,2}) \* \* \* \*$/.exec(schedule.trim());
  if (two) {
    const a = Number(two[1]);
    const b = Number(two[2]);
    const at = `at :${two[1].padStart(2, '0')} and :${two[2].padStart(2, '0')}`;
    return Math.abs(a - b) === 30 ? `every 30 minutes (${at})` : `twice an hour (${at})`;
  }
  return schedule.trim();
}

// One line for the panel header, plus how much attention it needs.
export function describeBuildStatus(
  s: Pick<ChainBuildStatus, 'cron_installed' | 'job_scheduled' | 'job_active' | 'per_run' | 'configured' | 'queued_count'>,
): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  if (!s.cron_installed) return { label: 'pg_cron is not installed', tone: 'bad' };
  if (!s.job_scheduled) return { label: 'Not scheduled', tone: 'bad' };
  if (!s.job_active) return { label: 'Schedule is switched off', tone: 'warn' };
  if (!s.configured) return { label: 'Key not stored yet', tone: 'warn' };
  if (s.per_run <= 0) return { label: 'Paused', tone: 'warn' };
  return { label: `On · ${s.per_run} per run · ${s.queued_count} waiting`, tone: 'good' };
}

export function formatLastRun(at: string | null | undefined, status: string | null | undefined, now: Date = new Date()): string {
  if (!at) return 'never';
  const then = new Date(at).getTime();
  if (!Number.isFinite(then)) return 'never';
  const mins = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.floor(mins / 60)} h ago` : `${Math.floor(mins / 1440)} d ago`;
  return status ? `${ago} (${status})` : ago;
}

// ── Menu page suggestions from owners (migration 093) ───────────────────────
export interface ChainLinkSuggestion {
  chain_id: string;
  chain_name: string;
  suggested_link: string;
  owner_count: number;
  // true/false = the link's site does / does not match the chain's known website; null = the chain's website is unknown.
  matches_chain_website: boolean | null;
  chain_website: string | null;
  // The chain's built-in menu page today (null when it has none, so approving fills it; otherwise replacing it).
  current_menu_url?: string | null;
}

// Replacing an existing page is a separate, explicit choice from filling an empty one.
export function isReplacement(s: Pick<ChainLinkSuggestion, 'current_menu_url'>): boolean {
  return !!s.current_menu_url;
}

// The confirm text for a replacement: both links, so the admin sees exactly what changes.
export function buildReplaceMessage(
  s: Pick<ChainLinkSuggestion, 'chain_name' | 'suggested_link' | 'current_menu_url'>,
): string {
  return `${s.chain_name} already has a built-in menu page.\n\nCurrent:\n${s.current_menu_url ?? ''}\n\nReplace it with:\n${s.suggested_link}\n\nThe old one is not kept.`;
}

// How much to trust a suggestion at a glance (the admin still decides).
export function describeSuggestionTrust(
  s: Pick<ChainLinkSuggestion, 'matches_chain_website' | 'owner_count'>,
): { label: string; tone: 'good' | 'warn' | 'neutral' } {
  const who = s.owner_count === 1 ? '1 owner' : `${s.owner_count} owners`;
  if (s.matches_chain_website === true) return { label: `Same site as the chain · ${who}`, tone: 'good' };
  if (s.matches_chain_website === false) return { label: `Different site from the chain · ${who}`, tone: 'warn' };
  return { label: `Chain website unknown · ${who}`, tone: 'neutral' };
}

// Shorter text for the link in a row: no scheme, no www.
export function shortLink(link: string, max = 60): string {
  const trimmed = link.replace(/^https?:\/\/(www\.)?/, '');
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

// ── Recent builds list (migration 097) ──────────────────────────────────────
export interface ChainBuildLogRow {
  started_at: string;
  chain_id: string;
  chain_name: string;
  // "scheduled" (the hourly job) or "run now" (the admin button)
  source: string;
  // ok | no_menu_link | unreadable | error, or running / no_result (started and never finished)
  outcome: string;
  item_count: number;
  detail: string | null;
  finished_at: string | null;
  // 'chain' or 'place' (an independent restaurant, migration 105); absent before that migration
  kind?: 'chain' | 'place';
  // the restaurant's place for an independent row (migration 120); null for franchises
  place_id?: string | null;
}

// How far back the list looks.
export const BUILD_LOG_HOURS = [6, 24, 72, 168];

export function describeBuildOutcome(outcome: string): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  switch (outcome) {
    case 'ok': return { label: 'Built', tone: 'good' };
    case 'running': return { label: 'Running', tone: 'neutral' };
    case 'no_menu_link': return { label: 'No menu link', tone: 'bad' };
    case 'unreadable': return { label: 'Page not readable', tone: 'bad' };
    case 'error': return { label: 'Error', tone: 'bad' };
    case 'no_result': return { label: 'No result', tone: 'warn' };
    case 'needs_attention': return { label: 'Needs attention', tone: 'bad' };
    case 'waiting': return { label: 'Waiting', tone: 'neutral' };
    case 'no_items': return { label: 'No dishes found', tone: 'warn' };
    default: return { label: outcome, tone: 'neutral' };
  }
}

const FAILED_OUTCOMES = new Set(['no_menu_link', 'unreadable', 'error', 'no_result', 'needs_attention', 'no_items']);

// A failed build gets a "Manage" shortcut. A FRANCHISE opens that chain's Manage window (to fix its link or store);
// an independent restaurant (migration 120) opens its menu editor by place, to upload a menu. Successful, waiting and
// still-running builds need nothing.
export function canManageFromBuild(row: Pick<ChainBuildLogRow, 'outcome' | 'kind' | 'chain_id'> & { place_id?: string | null }): boolean {
  if (!FAILED_OUTCOMES.has(row.outcome)) return false;
  if (row.kind === 'place') return !!row.place_id;
  return !!row.chain_id;
}

// Franchise Menu Management opens this chain's Manage window straight away when given ?manage=<chain id>.
export function manageChainParams(chainId: string): { manage: string } {
  return { manage: chainId };
}

export function summarizeBuildLog(rows: Pick<ChainBuildLogRow, 'outcome'>[]): { total: number; built: number; failed: number; running: number } {
  const bad = new Set(['no_menu_link', 'unreadable', 'error', 'no_result', 'needs_attention', 'no_items']);
  return {
    total: rows.length,
    built: rows.filter((r) => r.outcome === 'ok').length,
    failed: rows.filter((r) => bad.has(r.outcome)).length,
    running: rows.filter((r) => r.outcome === 'running').length,
  };
}

// ── The menu queue (migrations 101-102) ─────────────────────────────────────
export interface MenuQueueRun {
  chains: number;
  places: number;
}

// What the admin is told after pressing "Run queue now".
export function describeQueueRun(run: MenuQueueRun): string {
  const parts: string[] = [];
  if (run.places > 0) parts.push(`${run.places} restaurant${run.places === 1 ? '' : 's'}`);
  if (run.chains > 0) parts.push(`${run.chains} franchise${run.chains === 1 ? '' : 's'}`);
  if (parts.length === 0) {
    return 'Nothing is due: the queue is empty or waiting out a retry delay, builds are paused, or the key and server address are not stored yet.';
  }
  return `${parts.join(' and ')} are being built. Each takes up to a minute. Their results appear on the restaurant's menu, and anything that cannot be built is flagged for attention.`;
}

// What the admin is told after "Run queue now" on the independent restaurants (migration 106).
export function describePlaceRun(started: number): string {
  if (started <= 0) {
    return 'No restaurant is due: the queue is empty or waiting out a retry delay, builds are paused, or the key and server address are not stored yet.';
  }
  return `${started} restaurant${started === 1 ? ' is' : 's are'} being built. Each takes up to a minute. The result appears on the restaurant's menu, and anything that cannot be built is flagged for attention.`;
}

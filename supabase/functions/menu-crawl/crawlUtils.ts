// Pure helpers for the menu-crawl edge function (kept apart from index.ts so they can be unit tested).

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const LINK_RE = /^https?:\/\/[^\s]{4,2000}$/i;

export const MAX_WORK_JOBS = 5;
export const MAX_RESULT_NAMES = 400;
const MAX_NAME_LENGTH = 120;
const MAX_DETAIL_LENGTH = 300;
const MAX_TEXT_LENGTH = 200_000;      // get-chain-menu cuts it further, at 60,000 characters
const MIN_TEXT_LENGTH = 40;

// How many restaurants a worker may take per call: 1 to 5, default 3.
export function clampLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? Math.trunc(raw) : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(n, MAX_WORK_JOBS);
}

// How many restaurants the worker says it has already taken in this run (0 or more, whole number).
export function clampTaken(raw: unknown): number {
  const n = typeof raw === 'number' ? Math.trunc(raw) : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100000);
}

export type WorkerStatus = 'ok' | 'no_items' | 'error';

export interface CrawlResult {
  placeId: string;
  link: string;
  status: WorkerStatus;
  detail: string | null;
  // dish names the worker parsed itself (a fallback if the AI finds too few in the text)
  names: string[];
  // the menu text the worker read; the AI reads the dishes (and any stated calories) from it
  text: string;
}

// Checks what the worker sent for one restaurant. Returns the cleaned result, or a short reason it was refused.
export function parseCrawlResult(body: unknown): { ok: true; value: CrawlResult } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.placeId !== 'string' || !PLACE_ID_RE.test(b.placeId)) return { ok: false, error: 'placeId is not valid' };
  if (typeof b.link !== 'string' || !LINK_RE.test(b.link)) return { ok: false, error: 'link is not valid' };
  if (b.status !== 'ok' && b.status !== 'no_items' && b.status !== 'error') return { ok: false, error: 'status must be ok, no_items or error' };

  const detail = typeof b.detail === 'string' ? b.detail.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_DETAIL_LENGTH) || null : null;

  let names: string[] = [];
  let text = '';
  if (b.status === 'ok') {
    if (b.names !== undefined && !Array.isArray(b.names)) return { ok: false, error: 'names must be a list' };
    if (b.text !== undefined && typeof b.text !== 'string') return { ok: false, error: 'text must be a string' };
    names = (Array.isArray(b.names) ? b.names : [])
      .filter((n): n is string => typeof n === 'string')
      .map((n) => n.replace(/[\r\n\t]+/g, ' ').trim())
      .filter((n) => n.length >= 2 && n.length <= MAX_NAME_LENGTH)
      .slice(0, MAX_RESULT_NAMES);
    text = typeof b.text === 'string' ? b.text.slice(0, MAX_TEXT_LENGTH) : '';
    // something to build from: the menu text, or a list of dish names
    if (text.trim().length < MIN_TEXT_LENGTH) text = '';
    if (!text && names.length === 0) return { ok: false, error: 'a result needs menu text or dish names' };
  }
  return { ok: true, value: { placeId: b.placeId, link: b.link, status: b.status, detail, names, text } };
}

// What get-chain-menu's place mode answered, as the crawl status to record.
//   ok          -> the dishes were merged
//   unreadable  -> too few dishes came back: the page was read but is not a usable menu
//   is_chain    -> a franchise: nothing to do for a single place
//   anything else (error, ...) -> a technical failure, to be retried
export function crawlStatusFromBuild(buildStatus: unknown): WorkerStatus {
  if (buildStatus === 'ok') return 'ok';
  if (buildStatus === 'unreadable' || buildStatus === 'no_menu_link' || buildStatus === 'is_chain') return 'no_items';
  return 'error';
}

// Pure helpers for estimate-menu-nutrition (kept apart from index.ts so they can be unit tested).
// Each edge function is deployed on its own, so the small settings helpers here are this function's own copies of the
// ones in get-chain-menu.

// The most item names one save may have (each batch of them is estimated in its own AI call).
export const MAX_NAMES = 150;

// ── Settings (app_config: menuNutritionBatchSize, menuAiTimeoutSeconds) ─────────────────────────────────────────
export const DEFAULT_BATCH_SIZE = 10;
export const MIN_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 50;
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MIN_TIMEOUT_SECONDS = 5;
export const MAX_TIMEOUT_SECONDS = 120;
// A default self-hosted edge runtime ends a request after about a minute; retries stay inside this.
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

export function parseBatchSize(...candidates: unknown[]): number {
  return firstWholeNumberInRange(candidates, MIN_BATCH_SIZE, MAX_BATCH_SIZE) ?? DEFAULT_BATCH_SIZE;
}

export function parseTimeoutMs(...candidates: unknown[]): number {
  return (firstWholeNumberInRange(candidates, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS) ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
}

// A failed AI call is tried once more only if the retry could still finish inside the request budget.
export function retryCutoffMs(timeoutMs: number, budgetMs = REQUEST_BUDGET_MS): number {
  return Math.max(0, budgetMs - timeoutMs);
}

// The reply cap for a batch: about 200 tokens a dish (generous even if the model spreads each entry over many lines).
export function maxTokensFor(batchSize: number): number {
  return Math.min(12000, Math.max(1024, Math.round(batchSize) * 200));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

// ── The prompt ──────────────────────────────────────────────────────────────
export function buildNutritionPrompt(restaurantName: string, names: string[]): string {
  return `A restaurant owner for "${restaurantName}" has typed in the following list of REAL menu item names, exactly as they appear on their actual menu. Do not add, remove, rename, or reword any of them — estimate reasonable nutrition values for each one, in the same order.

Menu item names:
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Return ONLY a JSON array with exactly ${names.length} entries, one per item above in the same order, no markdown or explanation. Print it compactly: one entry per line, no indentation or extra spaces. Each entry must have these exact fields with numeric values (no strings):
- name (string, copy the item name exactly as given)
- calories (number)
- protein_g (number)
- totalCarbs_g (number)
- totalFat_g (number)
- saturatedFat_g (number)
- sodium_mg (number)
- dietaryFiber_g (number)
- sugars_g (number)`;
}

// ── Reading the reply ───────────────────────────────────────────────────────
// The entries of the AI's JSON array. If the reply was cut off mid-list, the complete entries before the cut are kept.
// null when nothing usable can be read.
export function parseEstimateReply(rawText: string): Record<string, unknown>[] | null {
  const cleaned = stripThinking(rawText ?? '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const whole = JSON.parse(cleaned);
    if (Array.isArray(whole)) return whole as Record<string, unknown>[];
  } catch {
    // fall through to the recovery below
  }

  const start = cleaned.indexOf('[');
  if (start < 0) return null;

  // Walk the text from the opening bracket, collecting each COMPLETE top-level {...} (strings and escapes aware).
  const items: Record<string, unknown>[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          const obj = JSON.parse(cleaned.slice(objStart, i + 1));
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) items.push(obj as Record<string, unknown>);
        } catch {
          // a malformed entry is skipped
        }
        objStart = -1;
      }
    }
  }
  return items.length > 0 ? items : null;
}

export interface Nutrition {
  calories: number;
  totalFat_g: number;
  saturatedFat_g: number;
  sodium_mg: number;
  totalCarbs_g: number;
  dietaryFiber_g: number;
  sugars_g: number;
  protein_g: number;
  servingWeightGrams: number | null;
}

// One estimated entry as the nutrition the menu stores. Missing or invalid numbers become 0 (a drink can truly be 0).
export function toNutrition(est: Record<string, unknown>): Nutrition {
  return {
    calories: Math.round(Number(est.calories) || 0),
    totalFat_g: Number(est.totalFat_g) || 0,
    saturatedFat_g: Number(est.saturatedFat_g) || 0,
    sodium_mg: Math.round(Number(est.sodium_mg) || 0),
    totalCarbs_g: Number(est.totalCarbs_g) || 0,
    dietaryFiber_g: Number(est.dietaryFiber_g) || 0,
    sugars_g: Number(est.sugars_g) || 0,
    protein_g: Number(est.protein_g) || 0,
    servingWeightGrams: null,
  };
}

// What to tell the owner when some batches could not be estimated. Nothing is saved in that case.
export function failureMessage(failed: number, total: number): string {
  return `${failed} of ${total} items could not be estimated (the AI timed out or returned an incomplete answer). ` +
    'Nothing was saved. Please try again.';
}

// ── The fast-model setup shared with the menu builds ─────────────────────────
// These are this function's own copies of the helpers in get-chain-menu (each edge function is deployed on its own).

// Some servers return the model's reasoning inline as <think>...</think>. Remove it so brackets inside the reasoning
// can't be mistaken for the JSON list.
export function stripThinking(text: string): string {
  return (text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')   // reasoning closed without an opening tag
    .trim();
}

// Qwen 3 models reason before answering unless told not to; "/no_think" is their documented soft switch.
// Added only for Qwen 3 models and only once.
export function withNoThink(prompt: string, model: string): string {
  if (!/qwen\s*-?\s*3/i.test(model ?? '')) return prompt;
  if (/\/no_think\s*$/.test(prompt)) return prompt;
  return `${prompt}\n\n/no_think`;
}

// True when a 400 says a request FIELD is unsupported (as opposed to a bad model name or an over-long prompt).
export function isUnsupportedFieldError(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  return /unsupported[_ ]?(request[_ ])?(field|param)|unknown (field|parameter)|unrecognized (field|request argument|parameter)|extra inputs are not permitted/i
    .test(message);
}

// Extra request fields set by an admin as semicolon-separated name=value pairs (the chainMenuModelParams setting), e.g.
// reasoning.enabled=false;temperature=0.2. A dot nests. The fields the function sets itself can never be overridden.
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

// The start of an unusable reply as one short line for the log (never the whole reply).
export function describeReply(raw: unknown, max = 200): string {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '(empty reply)';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ── Keeping what the menu already has ────────────────────────────────────────
// Saving the Edit Menu list used to re-estimate EVERY name with the AI and rewrite the whole menu. A name that is
// already on the restaurant's menu now keeps the nutrition it has, and only genuinely new names go to the AI. A renamed
// item is a different name, so it counts as new.

// The columns of menu_items this needs.
export interface ExistingRow {
  name: string | null;
  calories?: number | null;
  protein_g?: number | null;
  total_carbs_g?: number | null;
  total_fat_g?: number | null;
  saturated_fat_g?: number | null;
  sodium_mg?: number | null;
  dietary_fiber_g?: number | null;
  sugars_g?: number | null;
  serving_weight_grams?: number | null;
  is_verified?: boolean | null;
  is_out_of_stock?: boolean | null;
}

// Capitals, extra spaces and spaces at the ends do not make a different dish.
export function normalizeItemName(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// A row with no nutrition at all (every value 0 or missing) is what a failed or empty estimate used to save: it is not
// worth keeping, so that name is estimated again.
export function hasUsableNutrition(row: ExistingRow): boolean {
  return num(row.calories) > 0 || num(row.protein_g) > 0 || num(row.total_carbs_g) > 0 || num(row.total_fat_g) > 0 ||
    num(row.saturated_fat_g) > 0 || num(row.sodium_mg) > 0;
}

export function rowToNutrition(row: ExistingRow): Nutrition {
  const serving = Number(row.serving_weight_grams);
  return {
    calories: Math.round(num(row.calories)),
    totalFat_g: num(row.total_fat_g),
    saturatedFat_g: num(row.saturated_fat_g),
    sodium_mg: Math.round(num(row.sodium_mg)),
    totalCarbs_g: num(row.total_carbs_g),
    dietaryFiber_g: num(row.dietary_fiber_g),
    sugars_g: num(row.sugars_g),
    protein_g: num(row.protein_g),
    servingWeightGrams: Number.isFinite(serving) && serving > 0 ? serving : null,
  };
}

// What the menu already says about an item besides its nutrition: whether it is confirmed and whether it is out of stock.
// The Edit Menu screen changes these straight away (the Unconfirm and out-of-stock buttons), so saving the list must not
// undo them.
export interface ItemState {
  isVerified: boolean;
  isOutOfStock: boolean;
}

export interface EstimatePlan {
  // for each name (same order): the nutrition it already has, or null if it is new
  kept: (Nutrition | null)[];
  // for each name (same order): its current confirmed / out-of-stock state, or null if it is not on the menu yet
  state: (ItemState | null)[];
  // the names that need the AI, with their position in `names`
  toEstimate: { index: number; name: string }[];
}

export function planEstimates(names: string[], existing: ExistingRow[]): EstimatePlan {
  const known = new Map<string, Nutrition>();
  const states = new Map<string, ItemState>();
  for (const row of existing) {
    const key = normalizeItemName(row.name);
    if (!key) continue;
    if (!states.has(key)) states.set(key, { isVerified: row.is_verified === true, isOutOfStock: row.is_out_of_stock === true });
    if (!known.has(key) && hasUsableNutrition(row)) known.set(key, rowToNutrition(row));
  }
  const kept: (Nutrition | null)[] = [];
  const state: (ItemState | null)[] = [];
  const toEstimate: { index: number; name: string }[] = [];
  names.forEach((name, index) => {
    const key = normalizeItemName(name);
    const have = known.get(key);
    kept.push(have ?? null);
    state.push(states.get(key) ?? null);
    if (!have) toEstimate.push({ index, name });
  });
  return { kept, state, toEstimate };
}

// Whether an item is saved as confirmed: a name already on the menu keeps its current state (so an item the owner
// unconfirmed stays unconfirmed); a new name is confirmed, because the owner typed it as a real dish.
export function savedAsVerified(state: ItemState | null): boolean {
  return state ? state.isVerified : true;
}

// The names to mark out of stock again after the menu is rewritten (the rewrite starts every item in stock).
export function outOfStockNames(names: string[], state: (ItemState | null)[]): string[] {
  return names.filter((_, i) => state[i]?.isOutOfStock === true);
}

// A Google place ID (the restaurant's own menu is keyed by it).
export function isValidPlaceId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value);
}

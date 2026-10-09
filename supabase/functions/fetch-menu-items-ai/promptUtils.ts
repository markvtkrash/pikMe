// Pure helpers for fetch-menu-items-ai (kept apart from index.ts so they can be unit tested).

const MAX_LOCATION_LENGTH = 200;

// A place's address and city as one short line for the AI prompt, or null when there is nothing usable.
// The values come from our own cached Google places, but they are still cleaned (quotes, line breaks, length) so
// they can never break out of the prompt's labeled lines or add instructions on extra lines.
export function formatLocation(address?: string | null, city?: string | null): string | null {
  const clean = (v?: string | null) => (v ?? '').replace(/["\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  const a = clean(address);
  const c = clean(city);
  // Google often already ends the address with the city: do not repeat it.
  const joined = a && c && !a.toLowerCase().includes(c.toLowerCase()) ? `${a}, ${c}` : a || c;
  return joined ? joined.slice(0, MAX_LOCATION_LENGTH) : null;
}

// Google's own category tags are on every cached place (for example mexican_restaurant, bar, meal_takeaway). They
// are the best cuisine hint we have, so they go to the AI as readable text. Tags that say nothing about the food
// are dropped, anything that is not a plain tag is ignored, and at most four are kept.
const UNHELPFUL_TAGS = new Set([
  'restaurant', 'food', 'point_of_interest', 'establishment', 'store', 'health', 'premise',
  'meal_takeaway', 'meal_delivery', 'finance', 'lodging',
]);

export function formatCuisine(types?: string[] | null): string | null {
  if (!Array.isArray(types)) return null;
  const readable = types
    .filter((t): t is string => typeof t === 'string' && /^[a-z0-9_]{2,40}$/.test(t) && !UNHELPFUL_TAGS.has(t))
    .slice(0, 4)
    .map((t) => t.replace(/_/g, ' '));
  return readable.length > 0 ? readable.join(', ') : null;
}

// The prompt for the AI guess, kept short. The restaurant is given as labeled fields (name, then address when
// known), then ONE task: the dishes this particular restaurant most likely serves, with the nutrition of each.
// Health-conscious preferences are NOT part of the guess (the app ranks items for each customer later). Without a
// location it is the same prompt with the name alone.
export function buildMenuGuessPrompt(
  restaurantName: string,
  count: number,
  location: string | null,
  cuisine: string | null = null,
): string {
  const lines = [`Restaurant name: "${restaurantName}"`];
  if (location) lines.push(`Address: ${location}`);
  if (cuisine) lines.push(`Google category: ${cuisine}`);
  const identify = location || cuisine
    ? 'Use these to identify it and its cuisine.'
    : 'Use the name to identify it and its cuisine.';

  return `Nutrition app: estimate one restaurant's menu.
${lines.join('\n')}
${identify}

List ${count} dishes it most likely serves, every one fitting that cuisine: best-known first, a mix of mains, sides, drinks and desserts. Leave out staples that do not belong to its cuisine (for example burgers or onion rings at a Mexican restaurant) unless it is that kind of place. If unfamiliar, list typical dishes for its cuisine. No dishes from other chains, no unusual invented dishes. Estimate nutrition for a normal serving.

Return ONLY a JSON array of objects, no markdown or explanation. Print it compactly: one item per line, no indentation or extra spaces. Fields (numbers, not strings, except name): name, calories, protein_g, totalCarbs_g, totalFat_g, saturatedFat_g, sodium_mg, dietaryFiber_g, sugars_g.`;
}

// ── The model for this guess (the menuGuessModel setting) ───────────────────
// The first candidate that is a usable model name (app_config, then the env var), or null meaning "use the app-wide
// model". Only plain model-name characters are accepted, so a stray value can never reach the AI request.
export function pickModel(...candidates: (string | null | undefined)[]): string | null {
  for (const raw of candidates) {
    const name = (raw ?? '').trim();
    if (/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,99}$/.test(name)) return name;
  }
  return null;
}

// ── The reply-length cap (the menuGuessMaxTokens setting) ───────────────────
export const DEFAULT_MENU_GUESS_MAX_TOKENS = 4096;
export const MIN_MENU_GUESS_MAX_TOKENS = 1024;
export const MAX_MENU_GUESS_MAX_TOKENS = 32000;

// app_config first, then the env var, then the default. A blank, non-numeric or out-of-range value is ignored in
// favour of the next candidate, so a bad setting can never stop the guess.
export function parseMenuGuessMaxTokens(...candidates: (string | null | undefined)[]): number {
  for (const raw of candidates) {
    const text = (raw ?? '').trim();
    if (!/^[0-9]{1,6}$/.test(text)) continue;
    const n = Number(text);
    if (n >= MIN_MENU_GUESS_MAX_TOKENS && n <= MAX_MENU_GUESS_MAX_TOKENS) return n;
  }
  return DEFAULT_MENU_GUESS_MAX_TOKENS;
}

// ── Reading the reply ───────────────────────────────────────────────────────
export interface ParsedGuess {
  items: Record<string, unknown>[];
  // true when the reply was cut off and only the complete items before the cut were kept
  recovered: boolean;
}

// Strips markdown fences, then reads the JSON array. If the reply was cut off mid-list (it hit the reply cap), the
// complete objects before the cut are kept instead of failing the whole guess. Returns null when nothing usable
// can be read.
export function parseGuessReply(rawText: string): ParsedGuess | null {
  const cleaned = (rawText ?? '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const whole = JSON.parse(cleaned);
    if (Array.isArray(whole)) return { items: whole as Record<string, unknown>[], recovered: false };
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
          // a malformed object is skipped
        }
        objStart = -1;
      }
    }
  }
  return items.length > 0 ? { items, recovered: true } : null;
}

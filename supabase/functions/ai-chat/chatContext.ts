// What the Quick Find chat is allowed to talk about, and how it must talk about it. Pure helpers, kept apart from index.ts so they can be tested.
//
// Quick Find recommends ONLY from the CONFIRMED menu items of the restaurants near the person (items with is_verified = true: the restaurant or an admin
// confirmed them). It is given those items, with the calories and protein we hold, and told to use nothing else. It never sees a person's name or allergens.

export interface NearbyPlace {
  placeId: string | null;
  name: string;
}

// Newer apps send the restaurants with their place IDs; older ones send only names. At most `max`, each once.
// deno-lint-ignore no-explicit-any
export function normalizePlaces(restaurants: any, names: any, max = 12): NearbyPlace[] {
  const out: NearbyPlace[] = [];
  const seen = new Set<string>();
  const add = (placeId: unknown, name: unknown) => {
    if (typeof name !== 'string' || !name.trim()) return;
    const key = (typeof placeId === 'string' && placeId) || `name:${name.trim().toLowerCase()}`;
    if (seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push({ placeId: typeof placeId === 'string' && placeId ? placeId : null, name: name.trim().slice(0, 120) });
  };
  if (Array.isArray(restaurants)) for (const r of restaurants) add(r?.placeId, r?.name);
  if (out.length === 0 && Array.isArray(names)) for (const n of names) add(null, n);
  return out;
}

export interface MenuRow {
  name?: string | null;
  calories?: number | null;
  protein_g?: number | null;
  is_verified?: boolean | null;
}

// The confirmed items of one restaurant, at most `max`, as "- Name (420 cal, 31g protein)". Only numbers we hold are written; nothing is filled in.
export function confirmedItemLines(rows: MenuRow[] | null | undefined, max = 6): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const r of rows ?? []) {
    if (r?.is_verified !== true) continue;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const facts: string[] = [];
    if (typeof r.calories === 'number' && r.calories > 0) facts.push(`${Math.round(r.calories)} cal`);
    if (typeof r.protein_g === 'number' && r.protein_g > 0) facts.push(`${Math.round(r.protein_g)}g protein`);
    lines.push(`- ${name.slice(0, 100)}${facts.length ? ` (${facts.join(', ')})` : ''}`);
    if (lines.length >= max) break;
  }
  return lines;
}

// The block of restaurants and their confirmed items. Restaurants with none are left out. Empty string when there is nothing at all.
export function formatMenuBlock(entries: { place: NearbyPlace; lines: string[] }[]): string {
  return entries
    .filter((e) => e.lines.length > 0)
    .map((e) => `${e.place.name}:\n${e.lines.join('\n')}`)
    .join('\n\n');
}

export interface ProfileForChat {
  healthGoals?: unknown;
  dietaryRestrictions?: unknown;
  cuisinePreferences?: unknown;
}

const list = (v: unknown, fallback: string) => (Array.isArray(v) && v.length > 0 ? v.filter((x) => typeof x === 'string').join(', ') || fallback : fallback);

export const NO_CONFIRMED_ITEMS = '(none: there are no confirmed menu items near the person right now)';

export function buildSystemPrompt(profile: ProfileForChat | null | undefined, menuBlock: string, restrictions: string[]): string {
  const goals = list(profile?.healthGoals, 'none given');
  const prefs = restrictions.length > 0 ? restrictions.join(', ') : 'none given';
  const cuisines = list(profile?.cuisinePreferences, 'any');
  return `You are Quick Find, a food suggestion helper inside a restaurant app. Answer ONLY from the confirmed menu items listed below.

The person's preferences (a guide to what to suggest, never a guarantee): goals: ${goals}; diet: ${prefs}; cuisines: ${cuisines}.

CONFIRMED MENU ITEMS NEAR THE PERSON (restaurant, then its items; calories and protein are only given when we hold them):
${menuBlock || NO_CONFIRMED_ITEMS}

RULES:
- Suggest ONLY items from the list above, by their exact name and restaurant. Never invent a dish, a restaurant, a price or a nutrition number. Use only the numbers shown.
- If nothing in the list fits, or the list is empty, say so in one bullet and suggest opening a restaurant's menu in the app.
- Never say or imply that an item is safe for, free of, or suitable for an allergy, an intolerance, a medical condition or a religious diet. Never give medical, allergy or treatment advice. If asked, say you cannot advise on that and they should ask the restaurant.
- Do not call anything "healthy", "the best" or "safe". Say an item "may fit" what they asked.
- Ingredients are not shown here: never describe what a dish contains.

OUTPUT FORMAT - DO NOT DEVIATE:
Respond ONLY with up to 3 bullet points, each on its own line, in this form:
• [1-3 words]: [1 short sentence]`;
}

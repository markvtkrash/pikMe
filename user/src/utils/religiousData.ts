// PikMe does not collect or use religious preference data. Dietary options
// that are really religious identifiers (Halal, Kosher, Hindu Meal, ...) are
// not offered, and anything of that kind that still turns up — an old app
// build, an old stored profile, or something the AI extracted from free text —
// is stripped at every boundary (when profiles are read, saved and extracted,
// and again server-side) so it is never stored, ranked on, or sent to an AI.
//
// Keep this pattern in sync with public.is_religious_dietary_value (migration
// 068) and the copies in the ai-onboard / ai-chat / ai-item-analysis edge
// functions.
const RELIGIOUS_VALUE_PATTERN =
  /halal|kosher|hindu|jain|buddh|muslim|islam|jewish|christian|sikh|religio|ramadan|sabbath/i;

export function isReligiousDietaryValue(value: unknown): boolean {
  return typeof value === 'string' && RELIGIOUS_VALUE_PATTERN.test(value);
}

// Returns the list without any religious value; tolerates null/undefined and
// non-string entries (returns []/drops them) since profiles come from the
// network.
export function stripReligiousDietary<T = string>(values: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v) => typeof v === 'string' && !isReligiousDietaryValue(v));
}

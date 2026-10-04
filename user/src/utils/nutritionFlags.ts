export interface NutritionLike {
  calories: number;
  sodium_mg: number;
  saturatedFat_g: number;
  sugars_g: number;
}

// FDA %DV-style thresholds (roughly "high" = ~20%+ of a 2000-cal day's
// reference value, with calories itself judged against a single-meal share
// of that day). Deliberately asymmetric: this only ever asserts "High X",
// never "Low X" or "Moderate X" — nutrition values here are AI estimates,
// and a wrong "low sodium" claim could give someone a false sense of safety
// in a way a missing label never would. No flag for an item just means
// nothing cleared the high-confidence bar, not that it's actually low.
const HIGH_CALORIES = 700;
const HIGH_SODIUM_MG = 600;
const HIGH_SATURATED_FAT_G = 6;
const HIGH_SUGAR_G = 25;

export function getNutritionFlags(n: NutritionLike): string[] {
  const flags: string[] = [];
  if (n.calories >= HIGH_CALORIES) flags.push('High Calories');
  if (n.sodium_mg >= HIGH_SODIUM_MG) flags.push('High Sodium');
  if (n.saturatedFat_g >= HIGH_SATURATED_FAT_G) flags.push('High Saturated Fat');
  if (n.sugars_g >= HIGH_SUGAR_G) flags.push('High Sugar');
  return flags;
}

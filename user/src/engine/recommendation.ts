import type { MenuItem, UserProfile, Restaurant, Recommendation, NutritionTargets } from '../types';

// ── Reference thresholds ──────────────────────────────────────────────────────
const CAL_IDEAL = 400;
const CAL_BAD = 1000;
const PROTEIN_IDEAL = 30;
const PROTEIN_BAD = 5;
const CARBS_IDEAL = 20;
const CARBS_BAD = 80;
const SODIUM_IDEAL = 400;
const SODIUM_BAD = 1500;
const SATFAT_IDEAL = 3;
const SATFAT_BAD = 15;

// ── Normalisation helpers ─────────────────────────────────────────────────────

function scoreLow(value: number, good: number, bad: number): number {
  if (value <= good) return 1;
  if (value >= bad) return 0;
  return 1 - (value - good) / (bad - good);
}

function scoreHigh(value: number, good: number, bad: number): number {
  if (value >= good) return 1;
  if (value <= bad) return 0;
  return (value - bad) / (good - bad);
}

// ── Weights adjusted by health goals ─────────────────────────────────────────

interface Weights {
  cal: number;
  protein: number;
  carbs: number;
  sodium: number;
  satfat: number;
  cuisine: number;
}

function getWeights(goals: UserProfile['healthGoals']): Weights {
  const w: Weights = { cal: 30, protein: 20, carbs: 15, sodium: 15, satfat: 10, cuisine: 10 };
  for (const g of goals) {
    if (g === 'weight_loss')     { w.cal *= 1.5; w.protein *= 1.3; }
    if (g === 'low_carb')        { w.carbs *= 2.0; }
    if (g === 'heart_healthy')   { w.satfat *= 2.0; w.sodium *= 1.5; }
    if (g === 'high_protein')    { w.protein *= 2.5; }
    if (g === 'low_sodium')      { w.sodium *= 3.0; }
    if (g === 'diabetic_friendly') { w.carbs *= 1.8; }
  }
  return w;
}

// ── Hard filters ─────────────────────────────────────────────────────────────

const VEGAN_PATTERN =
  /chicken|beef|pork|fish|shrimp|turkey|bacon|ham|lamb|dairy|cheese|butter|milk|egg|mayo/i;
const VEGETARIAN_PATTERN =
  /chicken|beef|pork|fish|shrimp|turkey|bacon|ham|lamb/i;
const GLUTEN_PATTERN =
  /bread|pasta|bun|wrap|tortilla|wheat|flour|sandwich|sub|burger|waffle|pancake/i;
const HALAL_PATTERN =
  /pork|bacon|ham|lard/i;

function passesHardFilters(
  item: MenuItem,
  restrictions: UserProfile['dietaryRestrictions'],
  allergens: string[],
  targets: NutritionTargets
): boolean {
  const name = item.name.toLowerCase();
  const cal = item.nutrition.calories;

  // Calorie hard cap: 1.5× user's max meal calories
  if (targets.maxMealCalories && cal > targets.maxMealCalories * 1.5) return false;

  // Dietary restrictions
  if (restrictions.includes('vegan') && VEGAN_PATTERN.test(name)) return false;
  if (restrictions.includes('vegetarian') && VEGETARIAN_PATTERN.test(name)) return false;
  if (restrictions.includes('gluten_free') && GLUTEN_PATTERN.test(name)) return false;
  if (restrictions.includes('halal') && HALAL_PATTERN.test(name)) return false;

  // Allergens
  for (const allergen of allergens) {
    if (allergen && name.includes(allergen.toLowerCase())) return false;
  }

  return true;
}

// ── Cuisine match ─────────────────────────────────────────────────────────────

function hasCuisineMatch(
  restaurant: Restaurant,
  preferences: UserProfile['cuisinePreferences']
): boolean {
  const types = restaurant.cuisineTypes.map((t) => t.toLowerCase());
  return preferences.some((p) => types.some((t) => t.includes(p)));
}

// ── Soft scoring + reasons/warnings ──────────────────────────────────────────

function buildRecommendation(
  item: MenuItem,
  profile: UserProfile,
  restaurant: Restaurant,
  weights: Weights,
  cuisineMatch: boolean,
  rank: number
): Recommendation {
  const n = item.nutrition;
  const targets = profile.nutritionTargets;

  const calScore   = scoreLow(n.calories, CAL_IDEAL, CAL_BAD);
  const protScore  = scoreHigh(n.protein_g, PROTEIN_IDEAL, PROTEIN_BAD);
  const carbScore  = scoreLow(n.totalCarbs_g, CARBS_IDEAL, CARBS_BAD);
  const sodScore   = scoreLow(n.sodium_mg, SODIUM_IDEAL, SODIUM_BAD);
  const satfScore  = scoreLow(n.saturatedFat_g, SATFAT_IDEAL, SATFAT_BAD);
  const cuisScore  = cuisineMatch ? 1 : 0.5;

  const totalWeight =
    weights.cal + weights.protein + weights.carbs + weights.sodium + weights.satfat + weights.cuisine;

  const rawScore =
    (calScore * weights.cal +
      protScore * weights.protein +
      carbScore * weights.carbs +
      sodScore * weights.sodium +
      satfScore * weights.satfat +
      cuisScore * weights.cuisine) /
    totalWeight;

  const score = Math.round(rawScore * 100);

  // ── Reasons (positive) ──
  const reasons: string[] = [];
  if (n.calories < 350) reasons.push('Low calorie');
  if (n.protein_g >= 25) reasons.push('High protein');
  if (n.totalCarbs_g < 25) reasons.push('Low carb');
  if (n.sodium_mg < 500) reasons.push('Low sodium');
  if (n.saturatedFat_g < 3) reasons.push('Low saturated fat');
  if (cuisineMatch) reasons.push('Matches cuisine preference');
  if (targets.maxMealCalories && n.calories <= targets.maxMealCalories) {
    reasons.push('Within calorie budget');
  }

  // ── Warnings (negative) ──
  // Personalized to the user's goals & nutrition targets so the chips agree with
  // the AI "Should I get this?" analysis (e.g. flag sodium for a low-sodium diet
  // even when it's below the generic "high" threshold).
  const goals = profile.healthGoals ?? [];
  const hasGoal = (g: UserProfile['healthGoals'][number]) => goals.includes(g);

  const warnings: string[] = [];

  if (n.calories > 800 || (targets.maxMealCalories && n.calories > targets.maxMealCalories)) {
    warnings.push('High calorie');
  }

  const sodiumSensitive = hasGoal('low_sodium') || hasGoal('heart_healthy');
  if (
    n.sodium_mg > 1200 ||
    (targets.maxSodium_mg && n.sodium_mg > targets.maxSodium_mg) ||
    (sodiumSensitive && n.sodium_mg > 600)
  ) {
    warnings.push('High sodium');
  }

  const satfatSensitive = hasGoal('heart_healthy');
  if (
    n.saturatedFat_g > 10 ||
    (targets.maxSaturatedFat_g && n.saturatedFat_g > targets.maxSaturatedFat_g) ||
    (satfatSensitive && n.saturatedFat_g > 5)
  ) {
    warnings.push('High saturated fat');
  }

  const carbSensitive = hasGoal('low_carb') || hasGoal('diabetic_friendly');
  if (
    n.totalCarbs_g > 60 ||
    (targets.maxCarbs_g && n.totalCarbs_g > targets.maxCarbs_g) ||
    (carbSensitive && n.totalCarbs_g > 40)
  ) {
    warnings.push('High carbs');
  }

  return { menuItem: item, restaurant, score, reasons, warnings, rank };
}

// ── Public API ────────────────────────────────────────────────────────────────

// Verified (owner-confirmed real) items are preferred over unconfirmed AI
// guesses — but only as a preference, not a hard exclusion: if a restaurant
// doesn't have at least this many verified items passing the user's filters,
// unconfirmed ones are pulled in too (still ranked by relevance) so the
// customer isn't left with a near-empty or empty list.
const MIN_VERIFIED_ITEMS = 10;

export function scoreAndRankItems(
  profile: UserProfile,
  items: MenuItem[],
  restaurant: Restaurant,
  // Item ids with an active coupon. Any of these that fall outside the top-20
  // cap are appended after it (in their existing score order) rather than
  // dropped — a coupon shouldn't silently disappear from the page just
  // because personalization ranked it below the cutoff.
  couponItemIds?: Set<string>
): Recommendation[] {
  const weights = getWeights(profile.healthGoals);
  const cuisineMatch = hasCuisineMatch(restaurant, profile.cuisinePreferences);
  const targets = profile.nutritionTargets ?? {};
  const allergens = profile.allergens ?? [];
  const restrictions = profile.dietaryRestrictions ?? [];

  const passed = items.filter((item) =>
    passesHardFilters(item, restrictions, allergens, targets)
  );

  const ranked = passed
    .map((item, i) =>
      buildRecommendation(item, profile, restaurant, weights, cuisineMatch, i + 1)
    )
    .sort((a, b) => b.score - a.score);

  const verified = ranked.filter((r) => r.menuItem.isVerified);
  const unverified = ranked.filter((r) => !r.menuItem.isVerified);
  const combined = verified.length >= MIN_VERIFIED_ITEMS ? verified : [...verified, ...unverified];

  const top20 = combined.slice(0, 20);

  let final = top20;
  if (couponItemIds && couponItemIds.size > 0) {
    const includedIds = new Set(top20.map((r) => r.menuItem.itemId));
    const missedCoupons = combined.filter(
      (r) => couponItemIds.has(r.menuItem.itemId) && !includedIds.has(r.menuItem.itemId)
    );
    if (missedCoupons.length > 0) final = [...top20, ...missedCoupons];
  }

  return final.map((rec, i) => ({ ...rec, rank: i + 1 }));
}

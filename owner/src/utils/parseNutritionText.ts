import type { NutritionUpdate } from '../api/restaurantAuth';

// Parses lines like:
//   Chicken Tikka Masala | 620 cal | 38g protein | 45g carbs | 28g fat | 890mg sodium
// Fields are identified by their unit/keyword rather than position, so the
// order within a line doesn't matter — and a line with only some fields
// (e.g. just calories) is fine too. Anything not recognized is left
// undefined, which means "don't touch this field" on the backend, not
// "clear it" — an owner enters whatever they actually know, nothing more.
export function parseNutritionText(text: string): NutritionUpdate[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) return null;

      const name = parts[0];
      const rest = parts.slice(1).join(' | ');
      const update: NutritionUpdate = { name };

      const cal = rest.match(/(\d+(?:\.\d+)?)\s*cal/i);
      if (cal) update.calories = Math.round(Number(cal[1]));

      const protein = rest.match(/(\d+(?:\.\d+)?)\s*g?\s*protein/i);
      if (protein) update.protein_g = Number(protein[1]);

      const carbs = rest.match(/(\d+(?:\.\d+)?)\s*g?\s*carbs?/i);
      if (carbs) update.totalCarbs_g = Number(carbs[1]);

      const fat = rest.match(/(\d+(?:\.\d+)?)\s*g?\s*fat/i);
      if (fat) update.totalFat_g = Number(fat[1]);

      const sodium = rest.match(/(\d+(?:\.\d+)?)\s*mg\s*sodium/i);
      if (sodium) update.sodium_mg = Math.round(Number(sodium[1]));

      return update;
    })
    .filter((u): u is NutritionUpdate => !!u && !!u.name);
}

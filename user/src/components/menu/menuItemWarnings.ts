import type { MenuItem } from '../../types';

export function getItemWarnings(item: MenuItem, userAllergens: string[], userRestrictions: string[]): { allergenWarnings: string[]; restrictionWarnings: string[] } {
  const itemNameLower = item.name.toLowerCase();

  // Common allergen keywords in dish names
  const allergenKeywords: { [key: string]: string[] } = {
    beef: ['beef', 'burger', 'steak', 'brisket', 'big mac', 'whopper', 'ribeye', 'meatball', 'bolognese', 'taco meat'],
    pork: ['pork', 'bacon', 'ham', 'sausage', 'ribs', 'carnitas', 'pulled pork'],
    chicken: ['chicken', 'poultry', 'wings', 'nuggets', 'fried chicken', 'rotisserie'],
    fish: ['fish', 'salmon', 'tuna', 'cod', 'trout', 'seafood'],
    shellfish: ['shrimp', 'crab', 'lobster', 'oyster', 'scallop', 'prawn', 'seafood'],
    'peanut': ['peanut', 'peanut butter'],
    'tree nut': ['almond', 'walnut', 'pecan', 'cashew', 'pistachio', 'macadamia', 'hazelnut'],
    'milk': ['milk', 'dairy', 'cheese', 'butter', 'cream', 'yogurt', 'ice cream', 'lactose'],
    'egg': ['egg', 'eggs'],
    'soy': ['soy', 'tofu', 'edamame'],
    'wheat': ['wheat', 'bread', 'pasta', 'flour', 'breaded', 'batter', 'sandwich'],
    'sesame': ['sesame'],
  };

  const restrictedMeats = ['beef', 'pork', 'chicken', 'turkey', 'lamb', 'duck', 'ham', 'bacon', 'sausage', 'meat', 'poultry'];
  const restrictedDairy = ['cheese', 'milk', 'butter', 'cream', 'yogurt', 'ice cream'];
  const restrictedGluten = ['wheat', 'bread', 'pasta', 'flour', 'breaded', 'batter'];

  const allergenWarnings: string[] = [];
  const restrictionWarnings: string[] = [];

  // Check for user's custom allergens with keyword matching
  for (const allergen of userAllergens) {
    const allergenLower = allergen.toLowerCase();
    const keywords = allergenKeywords[allergenLower] || [allergenLower];

    for (const keyword of keywords) {
      if (itemNameLower.includes(keyword)) {
        allergenWarnings.push(`Contains: ${allergen}`);
        break;
      }
    }
  }

  // Check dietary restrictions using keyword matching
  if (userRestrictions.includes('vegan')) {
    for (const meat of restrictedMeats) {
      const meatKeywords = allergenKeywords[meat] || [meat];
      for (const keyword of meatKeywords) {
        if (itemNameLower.includes(keyword)) {
          restrictionWarnings.push('Not vegan (contains meat)');
          break;
        }
      }
      if (restrictionWarnings.length > 0) break;
    }

    if (!restrictionWarnings.some(w => w.includes('meat'))) {
      for (const dairy of restrictedDairy) {
        if (itemNameLower.includes(dairy)) {
          restrictionWarnings.push('Contains dairy');
          break;
        }
      }
    }
  }

  if (userRestrictions.includes('vegetarian')) {
    for (const meat of restrictedMeats) {
      const meatKeywords = allergenKeywords[meat] || [meat];
      for (const keyword of meatKeywords) {
        if (itemNameLower.includes(keyword)) {
          restrictionWarnings.push('Not vegetarian (contains meat)');
          break;
        }
      }
      if (restrictionWarnings.length > 0) break;
    }
  }

  if (userRestrictions.includes('gluten_free')) {
    const glutenKeywords = allergenKeywords['wheat'] || ['wheat', 'bread', 'pasta', 'flour', 'breaded', 'batter'];
    for (const keyword of glutenKeywords) {
      if (itemNameLower.includes(keyword)) {
        restrictionWarnings.push('Contains gluten');
        break;
      }
    }
  }

  return { allergenWarnings, restrictionWarnings };
}

export function getSafeIndicator(item: MenuItem, score: number): boolean {
  return score >= 75 && item.nutrition.calories > 0;
}

import type { MenuItem } from '../../types';

// Warnings from the words in a dish NAME. A name never lists everything in a dish: a "cheese burger" may have beef, "Mexican rice" may be cooked in chicken or
// beef stock, a "garden soup" may use meat stock. So these warnings are written as "the name suggests ...", never as a statement of what is in the dish, and
// the lists lean toward warning too much and not too little (a false warning is a nuisance; a missing one can hurt someone). They are only a hint: the card
// also says on EVERY item that its ingredients are not verified, because a name with no matching word proves nothing.

// Words in a name that suggest each allergen or food group (matched anywhere in the name, so "cheeseburger" matches "burger").
const ALLERGEN_WORDS: { [key: string]: string[] } = {
  beef: ['beef', 'burger', 'steak', 'brisket', 'big mac', 'whopper', 'ribeye', 'sirloin', 'filet', 'veal', 'meatball', 'meatloaf', 'bolognese', 'taco meat', 'pastrami', 'corned beef', 'jerky', 'barbacoa', 'birria', 'gyro', 'patty', 'carne'],
  pork: ['pork', 'bacon', 'ham', 'sausage', 'ribs', 'carnitas', 'pulled pork', 'pepperoni', 'salami', 'prosciutto', 'pancetta', 'chorizo', 'lard', 'hot dog', 'bratwurst', 'al pastor', 'gyro'],
  chicken: ['chicken', 'poultry', 'wings', 'nuggets', 'tender', 'rotisserie', 'drumstick', 'pollo'],
  fish: ['fish', 'salmon', 'tuna', 'cod', 'trout', 'seafood', 'anchov', 'tilapia', 'halibut', 'snapper', 'mahi', 'sardine', 'caesar', 'fish sauce', 'worcestershire', 'sushi', 'pad thai'],
  shellfish: ['shrimp', 'crab', 'lobster', 'oyster', 'scallop', 'prawn', 'seafood', 'clam', 'mussel', 'crawfish', 'calamari', 'squid'],
  peanut: ['peanut', 'satay', 'pad thai'],
  'tree nut': ['almond', 'walnut', 'pecan', 'cashew', 'pistachio', 'macadamia', 'hazelnut', 'pesto', 'praline', 'marzipan', 'nutella'],
  milk: ['milk', 'dairy', 'cheese', 'butter', 'cream', 'yogurt', 'ice cream', 'lactose', 'whey', 'ghee', 'custard', 'alfredo', 'mozzarella', 'parmesan', 'cheddar', 'ricotta', 'latte', 'ranch', 'queso', 'paneer'],
  egg: ['egg', 'eggs', 'mayo', 'aioli', 'omelet', 'omelette', 'quiche', 'frittata', 'custard', 'meringue', 'carbonara', 'hollandaise'],
  soy: ['soy', 'tofu', 'edamame', 'miso', 'tempeh', 'teriyaki'],
  wheat: ['wheat', 'bread', 'pasta', 'flour', 'breaded', 'batter', 'sandwich', 'bun', 'burger', 'tortilla', 'wrap', 'noodle', 'ramen', 'dumpling', 'pizza', 'pancake', 'waffle', 'cake', 'cookie', 'pie', 'tempura', 'crusted', 'couscous', 'bagel', 'roll', 'crispy', 'fried', 'teriyaki', 'lasagna', 'calzone'],
  sesame: ['sesame', 'tahini', 'hummus'],
};

// Words that suggest meat or fish for a vegetarian or vegan: the groups above, plus dishes that often hide meat (stock, broth, lard, gelatin).
const HIDDEN_MEAT_WORDS = [
  'meat', 'turkey', 'lamb', 'duck', 'stock', 'broth', 'gravy', 'gelatin', 'gelatine', 'jambalaya', 'gumbo', 'paella', 'pot pie', 'pho', 'ramen',
  'refried beans', 'mexican rice', 'spanish rice', 'dirty rice', 'chili', 'stew', 'soup', 'dim sum', 'wonton', 'carbonara',
];
const MEAT_AND_FISH_WORDS = Array.from(new Set([
  ...ALLERGEN_WORDS.beef, ...ALLERGEN_WORDS.pork, ...ALLERGEN_WORDS.chicken, ...ALLERGEN_WORDS.fish, ...ALLERGEN_WORDS.shellfish, ...HIDDEN_MEAT_WORDS,
]));
const DAIRY_AND_EGG_WORDS = Array.from(new Set([...ALLERGEN_WORDS.milk, ...ALLERGEN_WORDS.egg, 'honey', 'gelatin', 'gelatine']));
const GLUTEN_WORDS = ALLERGEN_WORDS.wheat.concat(['beer', 'barley', 'rye', 'malt', 'soy', 'soy sauce', 'gnocchi', 'udon', 'seitan']);

function mentions(nameLower: string, words: string[]): boolean {
  return words.some((w) => nameLower.includes(w));
}

export function getItemWarnings(item: MenuItem, userAllergens: string[], userRestrictions: string[]): { allergenWarnings: string[]; restrictionWarnings: string[] } {
  const nameLower = item.name.toLowerCase();
  const allergenWarnings: string[] = [];
  const restrictionWarnings: string[] = [];

  // The person's allergens: a known group uses its word list, anything else is matched by its own words.
  for (const allergen of userAllergens) {
    const key = allergen.toLowerCase();
    const words = ALLERGEN_WORDS[key] || [key];
    if (mentions(nameLower, words)) {
      allergenWarnings.push(`The name suggests ${allergen}. Not confirmed: ask the restaurant.`);
    }
  }

  // Diets. "May not be" and "ask the restaurant": the name can suggest a problem but can never rule one out.
  if (userRestrictions.includes('vegan')) {
    if (mentions(nameLower, MEAT_AND_FISH_WORDS)) {
      restrictionWarnings.push('The name suggests meat or fish, so it may not be vegan. Ask the restaurant.');
    } else if (mentions(nameLower, DAIRY_AND_EGG_WORDS)) {
      restrictionWarnings.push('The name suggests dairy or egg, so it may not be vegan. Ask the restaurant.');
    }
  }

  if (userRestrictions.includes('vegetarian') && mentions(nameLower, MEAT_AND_FISH_WORDS)) {
    restrictionWarnings.push('The name suggests meat or fish, so it may not be vegetarian. Ask the restaurant.');
  }

  if (userRestrictions.includes('gluten_free') && mentions(nameLower, GLUTEN_WORDS)) {
    restrictionWarnings.push('The name suggests gluten, so it may not be gluten free. Ask the restaurant.');
  }

  return { allergenWarnings, restrictionWarnings };
}

// A calories-and-macros hint only: it says nothing about ingredients, allergens or diets.
export function getSafeIndicator(item: MenuItem, score: number): boolean {
  return score >= 75 && item.nutrition.calories > 0;
}

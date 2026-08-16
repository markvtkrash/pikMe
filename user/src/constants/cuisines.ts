// Curated cuisine filter, separate from the dynamic venue-type chips
// (cafe, bar, etc.) in explore.tsx. A restaurant matches a cuisine if EITHER:
// - one of its Google Places cuisineTypes is in `types`, or
// - its name contains one of `keywords` (case-insensitive)
// The `types` check alone isn't reliable — Google's classic Nearby Search API
// often tags real restaurants with only generic types (restaurant/cafe/bar)
// and no cuisine-specific subtype, even for obviously single-cuisine places.
export const CUISINE_FILTERS: { label: string; types: string[]; keywords: string[] }[] = [
  { label: 'Italian', types: ['italian_restaurant', 'pizza_restaurant'], keywords: ['italian', 'pizza', 'pizzeria', 'trattoria', 'pasta'] },
  { label: 'Mexican', types: ['mexican_restaurant'], keywords: ['mexican', 'taco', 'burrito', 'taqueria', 'cantina'] },
  { label: 'Indian', types: ['indian_restaurant'], keywords: ['indian', 'curry', 'tandoor', 'masala', 'punjabi', 'biryani'] },
  { label: 'Chinese', types: ['chinese_restaurant'], keywords: ['chinese', 'wok', 'dim sum', 'szechuan', 'canton'] },
  { label: 'Japanese', types: ['japanese_restaurant', 'sushi_restaurant', 'ramen_restaurant'], keywords: ['japanese', 'sushi', 'ramen', 'hibachi', 'teriyaki'] },
  { label: 'Thai', types: ['thai_restaurant'], keywords: ['thai'] },
  { label: 'Asian', types: ['asian_restaurant', 'korean_restaurant', 'vietnamese_restaurant'], keywords: ['asian', 'korean', 'vietnamese', 'pho', 'banh mi'] },
  { label: 'Mediterranean', types: ['mediterranean_restaurant', 'greek_restaurant', 'turkish_restaurant', 'lebanese_restaurant', 'middle_eastern_restaurant'], keywords: ['mediterranean', 'greek', 'turkish', 'lebanese', 'shawarma', 'gyro', 'falafel', 'kebab', 'hummus'] },
  { label: 'American', types: ['american_restaurant', 'hamburger_restaurant', 'barbecue_restaurant', 'steak_house'], keywords: ['burger', 'grill', 'bbq', 'steakhouse', 'diner'] },
  { label: 'French', types: ['french_restaurant'], keywords: ['french', 'bistro', 'brasserie'] },
  { label: 'Seafood', types: ['seafood_restaurant'], keywords: ['seafood', 'crab', 'lobster', 'oyster'] },
];

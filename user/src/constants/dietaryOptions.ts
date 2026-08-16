export const DIETARY_RESTRICTIONS = [
  { value: 'vegetarian', label: 'Vegetarian', icon: '🥗' },
  { value: 'vegan', label: 'Vegan', icon: '🌱' },
  { value: 'gluten_free', label: 'Gluten-Free', icon: '🌾' },
  { value: 'halal', label: 'Halal', icon: '☪️' },
  { value: 'kosher', label: 'Kosher', icon: '✡️' },
  { value: 'hindu_meal', label: 'Hindu Meal', icon: '🕉️' },
  { value: 'none', label: 'No Restrictions', icon: '✅' },
] as const;

export const HEALTH_GOALS = [
  { value: 'weight_loss', label: 'Weight Loss', description: 'Lower calorie options' },
  { value: 'low_carb', label: 'Low Carb', description: 'Limit carbohydrates' },
  { value: 'low_sodium', label: 'Low Sodium', description: 'Heart-friendly sodium levels' },
  { value: 'high_protein', label: 'High Protein', description: 'Muscle building & satiety' },
  { value: 'diabetic_friendly', label: 'Diabetic Friendly', description: 'Blood sugar management' },
  { value: 'heart_healthy', label: 'Heart Healthy', description: 'Low saturated fat' },
  { value: 'balanced', label: 'Balanced Diet', description: 'General healthy eating' },
] as const;

export const CUISINE_OPTIONS = [
  { value: 'american', label: 'American', emoji: '🍔' },
  { value: 'italian', label: 'Italian', emoji: '🍝' },
  { value: 'mexican', label: 'Mexican', emoji: '🌮' },
  { value: 'chinese', label: 'Chinese', emoji: '🥡' },
  { value: 'japanese', label: 'Japanese', emoji: '🍱' },
  { value: 'indian', label: 'Indian', emoji: '🍛' },
  { value: 'mediterranean', label: 'Mediterranean', emoji: '🫒' },
  { value: 'thai', label: 'Thai', emoji: '🍜' },
  { value: 'korean', label: 'Korean', emoji: '🥘' },
  { value: 'middle_eastern', label: 'Middle Eastern', emoji: '🧆' },
  { value: 'african', label: 'African', emoji: '🌍' },
  { value: 'ethiopian', label: 'Ethiopian', emoji: '🫓' },
  { value: 'caribbean', label: 'Caribbean', emoji: '🌴' },
  { value: 'vietnamese', label: 'Vietnamese', emoji: '🍲' },
  { value: 'french', label: 'French', emoji: '🥐' },
  { value: 'greek', label: 'Greek', emoji: '🥙' },
  { value: 'spanish', label: 'Spanish', emoji: '🍤' },
  { value: 'filipino', label: 'Filipino', emoji: '🍢' },
  { value: 'latin_american', label: 'Latin American', emoji: '🌯' },
  { value: 'soul_food', label: 'Soul Food', emoji: '🍗' },
] as const;

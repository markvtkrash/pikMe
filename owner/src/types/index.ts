export interface UserProfile {
  id: string;
  displayName: string;
  dietaryRestrictions: ('vegetarian' | 'vegan' | 'gluten_free' | 'halal' | 'kosher' | 'none')[];
  healthGoals: (
    | 'weight_loss'
    | 'low_carb'
    | 'low_sodium'
    | 'high_protein'
    | 'diabetic_friendly'
    | 'heart_healthy'
    | 'balanced'
  )[];
  cuisinePreferences: (
    | 'american'
    | 'italian'
    | 'mexican'
    | 'chinese'
    | 'japanese'
    | 'indian'
    | 'mediterranean'
    | 'thai'
    | 'korean'
    | 'middle_eastern'
  )[];
  allergens: string[];
  nutritionTargets: NutritionTargets;
  searchRadiusMeters: number;
  onboardingComplete: boolean;
}

export interface NutritionTargets {
  dailyCalories?: number;
  maxMealCalories?: number;
  maxCarbs_g?: number;
  maxSodium_mg?: number;
  minProtein_g?: number;
  maxSaturatedFat_g?: number;
}

export interface OpeningHours {
  open_now: boolean;
  weekday_text: string[];
  periods?: Array<{
    open: { day: number; time: string };
    close?: { day: number; time: string };
  }>;
}

export interface Restaurant {
  placeId: string;
  name: string;
  location: {
    latitude: number;
    longitude: number;
    address: string;
    city: string;
  };
  distanceMeters: number;
  rating: number;
  cuisineTypes: string[];
  photoUrl?: string;
  openNow: boolean;
  openingHours?: OpeningHours;
  hasNutritionData: boolean;
}

export interface MenuItem {
  itemId: string;
  restaurantName: string;
  name: string;
  imageUrl?: string;
  isVerified: boolean;
  nutrition: {
    calories: number;
    totalFat_g: number;
    saturatedFat_g: number;
    sodium_mg: number;
    totalCarbs_g: number;
    dietaryFiber_g: number;
    sugars_g: number;
    protein_g: number;
    servingWeightGrams?: number;
  };
}

export type RecommendationReason =
  | 'High protein'
  | 'Low carb'
  | 'Low calorie'
  | 'Low sodium'
  | 'Low saturated fat'
  | 'Matches cuisine preference'
  | 'Within calorie budget';

export interface Recommendation {
  menuItem: MenuItem;
  restaurant: Restaurant;
  score: number;
  reasons: string[];
  warnings: string[];
  rank: number;
  healthSummary?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ChatSession {
  messages: Message[];
  isStreaming: boolean;
}

export interface SavedItems {
  restaurants: Restaurant[];
  menuItems: MenuItem[];
}

export interface Coupon {
  id: string;
  restaurant_id: string;
  coupon_code: string;
  coupon_type: 'item_percent' | 'item_fixed' | 'generic_percent' | 'generic_fixed';
  discount_value: number;
  menu_item_id: string | null;
  is_active: boolean;
  expiry_date: string;
  usage_limit: number | null;
  times_used: number;
  created_at: string;
  updated_at: string;
  // Present only if the current customer already activated this coupon.
  activated_at: string | null;
  expires_at: string | null;
}

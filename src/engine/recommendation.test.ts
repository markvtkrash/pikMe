import { scoreAndRankItems } from './recommendation';
import type { MenuItem, Restaurant, UserProfile } from '../types';

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'user-1',
    displayName: 'Test User',
    dietaryRestrictions: [],
    healthGoals: [],
    cuisinePreferences: [],
    allergens: [],
    nutritionTargets: {},
    searchRadiusMeters: 5000,
    onboardingComplete: true,
    ...overrides,
  };
}

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    placeId: 'place-1',
    name: 'Test Restaurant',
    location: { latitude: 0, longitude: 0, address: '123 Main St', city: 'Testville' },
    distanceMeters: 500,
    rating: 4.5,
    cuisineTypes: ['american'],
    openNow: true,
    hasNutritionData: true,
    ...overrides,
  };
}

function makeItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    itemId: 'item-1',
    restaurantName: 'Test Restaurant',
    name: 'Grilled Chicken Salad',
    isVerified: false,
    nutrition: {
      calories: 300,
      totalFat_g: 10,
      saturatedFat_g: 2,
      sodium_mg: 400,
      totalCarbs_g: 15,
      dietaryFiber_g: 5,
      sugars_g: 3,
      protein_g: 35,
      ...overrides.nutrition,
    },
    ...overrides,
  };
}

describe('scoreAndRankItems', () => {
  it('scores a low-calorie, high-protein item highly', () => {
    const profile = makeProfile();
    const restaurant = makeRestaurant();
    const item = makeItem();

    const [rec] = scoreAndRankItems(profile, [item], restaurant);

    expect(rec.score).toBeGreaterThan(70);
    expect(rec.reasons).toContain('High protein');
    expect(rec.reasons).toContain('Low calorie');
  });

  it('filters out vegan-violating items for vegan users', () => {
    const profile = makeProfile({ dietaryRestrictions: ['vegan'] });
    const restaurant = makeRestaurant();
    const chicken = makeItem({ itemId: 'chicken', name: 'Grilled Chicken Salad' });
    const salad = makeItem({ itemId: 'salad', name: 'Garden Salad' });

    const results = scoreAndRankItems(profile, [chicken, salad], restaurant);

    expect(results.map((r) => r.menuItem.itemId)).toEqual(['salad']);
  });

  it('filters out items above 1.5x the max meal calorie cap', () => {
    const profile = makeProfile({ nutritionTargets: { maxMealCalories: 500 } });
    const restaurant = makeRestaurant();
    const withinCap = makeItem({ itemId: 'ok', nutrition: { ...makeItem().nutrition, calories: 700 } });
    const overCap = makeItem({ itemId: 'over', nutrition: { ...makeItem().nutrition, calories: 800 } });

    const results = scoreAndRankItems(profile, [withinCap, overCap], restaurant);

    expect(results.map((r) => r.menuItem.itemId)).toEqual(['ok']);
  });

  it('filters out items matching a user allergen', () => {
    const profile = makeProfile({ allergens: ['peanut'] });
    const restaurant = makeRestaurant();
    const safeItem = makeItem({ itemId: 'safe', name: 'Grilled Chicken Salad' });
    const allergenItem = makeItem({ itemId: 'unsafe', name: 'Peanut Noodle Bowl' });

    const results = scoreAndRankItems(profile, [safeItem, allergenItem], restaurant);

    expect(results.map((r) => r.menuItem.itemId)).toEqual(['safe']);
  });

  it('flags high sodium for a low_sodium goal below the generic threshold', () => {
    const profile = makeProfile({ healthGoals: ['low_sodium'] });
    const restaurant = makeRestaurant();
    const item = makeItem({ nutrition: { ...makeItem().nutrition, sodium_mg: 700 } });

    const [rec] = scoreAndRankItems(profile, [item], restaurant);

    expect(rec.warnings).toContain('High sodium');
  });

  it('adds "Matches cuisine preference" when restaurant cuisine matches profile', () => {
    const profile = makeProfile({ cuisinePreferences: ['italian'] });
    const restaurant = makeRestaurant({ cuisineTypes: ['italian_restaurant'] });
    const item = makeItem();

    const [rec] = scoreAndRankItems(profile, [item], restaurant);

    expect(rec.reasons).toContain('Matches cuisine preference');
  });

  it('sorts results by score descending and limits to 20 with sequential ranks', () => {
    const profile = makeProfile();
    const restaurant = makeRestaurant();
    const items = Array.from({ length: 25 }, (_, i) =>
      makeItem({
        itemId: `item-${i}`,
        name: `Item ${i}`,
        nutrition: { ...makeItem().nutrition, calories: 300 + i * 50 },
      })
    );

    const results = scoreAndRankItems(profile, items, restaurant);

    expect(results).toHaveLength(20);
    expect(results.map((r) => r.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('returns an empty array when every item fails a hard filter', () => {
    const profile = makeProfile({ dietaryRestrictions: ['vegan'] });
    const restaurant = makeRestaurant();
    const item = makeItem({ name: 'Bacon Cheeseburger' });

    const results = scoreAndRankItems(profile, [item], restaurant);

    expect(results).toEqual([]);
  });
});

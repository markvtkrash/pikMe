import { getNutritionFlags } from './nutritionFlags';

const base = { calories: 0, sodium_mg: 0, saturatedFat_g: 0, sugars_g: 0 };

describe('getNutritionFlags', () => {
  it('returns no flags for a low-everything item', () => {
    expect(getNutritionFlags({ ...base, calories: 300, sodium_mg: 200, saturatedFat_g: 2, sugars_g: 5 })).toEqual([]);
  });

  it('flags high calories at or above 700', () => {
    expect(getNutritionFlags({ ...base, calories: 699 })).toEqual([]);
    expect(getNutritionFlags({ ...base, calories: 700 })).toEqual(['High Calories']);
  });

  it('flags high sodium at or above 600mg', () => {
    expect(getNutritionFlags({ ...base, sodium_mg: 599 })).toEqual([]);
    expect(getNutritionFlags({ ...base, sodium_mg: 600 })).toEqual(['High Sodium']);
  });

  it('flags high saturated fat at or above 6g', () => {
    expect(getNutritionFlags({ ...base, saturatedFat_g: 5.9 })).toEqual([]);
    expect(getNutritionFlags({ ...base, saturatedFat_g: 6 })).toEqual(['High Saturated Fat']);
  });

  it('flags high sugar at or above 25g', () => {
    expect(getNutritionFlags({ ...base, sugars_g: 24 })).toEqual([]);
    expect(getNutritionFlags({ ...base, sugars_g: 25 })).toEqual(['High Sugar']);
  });

  it('never claims something is low — just omits the label', () => {
    const flags = getNutritionFlags({ ...base, calories: 100 });
    expect(flags.join(' ')).not.toMatch(/low/i);
  });

  it('can return multiple flags at once', () => {
    expect(getNutritionFlags({ calories: 900, sodium_mg: 1200, saturatedFat_g: 10, sugars_g: 30 })).toEqual([
      'High Calories', 'High Sodium', 'High Saturated Fat', 'High Sugar',
    ]);
  });
});

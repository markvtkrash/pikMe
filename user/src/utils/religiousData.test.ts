import { isReligiousDietaryValue, stripReligiousDietary } from './religiousData';

describe('isReligiousDietaryValue', () => {
  it.each([
    'halal',
    'kosher',
    'hindu_meal',
    'Halal',
    'KOSHER',
    'halal_certified',
    'jain',
    'buddhist',
    'muslim',
    'religious_diet',
    'ramadan',
  ])('flags %s', (value) => {
    expect(isReligiousDietaryValue(value)).toBe(true);
  });

  it.each([
    'vegetarian',
    'vegan',
    'gluten_free',
    'none',
    'peanuts',
    'shellfish',
    'low_sodium',
    'weight_loss',
    '',
  ])('does not flag %s', (value) => {
    expect(isReligiousDietaryValue(value)).toBe(false);
  });

  it('is false for non-string input', () => {
    expect(isReligiousDietaryValue(null)).toBe(false);
    expect(isReligiousDietaryValue(undefined)).toBe(false);
    expect(isReligiousDietaryValue(42)).toBe(false);
    expect(isReligiousDietaryValue({})).toBe(false);
  });
});

describe('stripReligiousDietary', () => {
  it('drops religious values and keeps the rest in order', () => {
    expect(stripReligiousDietary(['vegan', 'halal', 'gluten_free', 'kosher'])).toEqual(['vegan', 'gluten_free']);
    expect(stripReligiousDietary(['vegetarian', 'hindu_meal', 'vegan'])).toEqual(['vegetarian', 'vegan']);
  });

  it('returns an equal list when nothing needs dropping', () => {
    expect(stripReligiousDietary(['vegan', 'none'])).toEqual(['vegan', 'none']);
  });

  it('returns [] when only religious values are present', () => {
    expect(stripReligiousDietary(['halal', 'kosher', 'Hindu_Meal'])).toEqual([]);
  });

  it('tolerates null, undefined and non-array input (profiles come from the network)', () => {
    expect(stripReligiousDietary(null)).toEqual([]);
    expect(stripReligiousDietary(undefined)).toEqual([]);
    expect(stripReligiousDietary('halal' as any)).toEqual([]);
    expect(stripReligiousDietary({} as any)).toEqual([]);
  });

  it('drops non-string entries', () => {
    expect(stripReligiousDietary(['vegan', null, 7, undefined] as any)).toEqual(['vegan']);
  });

  it('does not mutate its input', () => {
    const input = ['vegan', 'halal'];
    stripReligiousDietary(input);
    expect(input).toEqual(['vegan', 'halal']);
  });
});

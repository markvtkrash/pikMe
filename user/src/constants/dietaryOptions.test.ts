import { DIETARY_RESTRICTIONS } from './dietaryOptions';
import { isReligiousDietaryValue } from '../utils/religiousData';

describe('DIETARY_RESTRICTIONS', () => {
  it('offers no religious option (PikMe does not collect religious preferences)', () => {
    const offending = DIETARY_RESTRICTIONS.filter(
      (o) => isReligiousDietaryValue(o.value) || isReligiousDietaryValue(o.label)
    );
    expect(offending).toEqual([]);
  });

  it('does not offer the specific options that were removed', () => {
    const values = DIETARY_RESTRICTIONS.map((o) => o.value as string);
    expect(values).not.toContain('halal');
    expect(values).not.toContain('kosher');
    expect(values).not.toContain('hindu_meal');
  });

  it('still offers the supported options, including "none"', () => {
    expect(DIETARY_RESTRICTIONS.map((o) => o.value)).toEqual(['vegetarian', 'vegan', 'gluten_free', 'none']);
  });

  it('has unique values', () => {
    const values = DIETARY_RESTRICTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

import { isBooleanValue, nextBooleanValue, switchQuestion } from './configValues';

describe('isBooleanValue', () => {
  it('is true only for the exact text true or false', () => {
    expect(isBooleanValue('true')).toBe(true);
    expect(isBooleanValue('false')).toBe(true);
  });

  it('keeps everything else as a text box', () => {
    for (const v of ['True', 'FALSE', ' true', 'true ', '1', '0', 'yes', '', '5', 'db', null, undefined]) {
      expect([v, isBooleanValue(v as any)]).toEqual([v, false]);
    }
  });
});

describe('nextBooleanValue', () => {
  it('flips between the two', () => {
    expect(nextBooleanValue('true')).toBe('false');
    expect(nextBooleanValue('false')).toBe('true');
  });
});

describe('switchQuestion', () => {
  it('names the setting and both values', () => {
    expect(switchQuestion('showFranchiseRestaurants', 'true')).toBe(
      'Switch "showFranchiseRestaurants" from true to false? The apps pick the change up within a few minutes.'
    );
    expect(switchQuestion('x', 'false')).toMatch(/from false to true/);
  });
});

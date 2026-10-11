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

import { QUICK_SWITCHES, quickSwitchQuestion } from './configValues';

describe('quick switches', () => {
  it('has the franchise and independent switches with plain names', () => {
    expect(QUICK_SWITCHES.map((q) => q.key)).toEqual(['showFranchiseRestaurants', 'showIndependentRestaurants']);
    expect(QUICK_SWITCHES.map((q) => q.title)).toEqual(['Franchise Restaurants', 'Independent Restaurants']);
  });

  it('asks in plain words to hide when on, and to show when off', () => {
    expect(quickSwitchQuestion(QUICK_SWITCHES[0], 'true')).toMatch(/^Hide all franchise restaurants from customers\?/);
    expect(quickSwitchQuestion(QUICK_SWITCHES[1], 'false')).toMatch(/^Show independent restaurants to customers again\?/);
  });
});

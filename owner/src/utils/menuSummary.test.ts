import { confirmedPercent, menuSummaryText } from './menuSummary';

describe('confirmedPercent', () => {
  it('is the rounded share of confirmed items, 0 to 100', () => {
    expect(confirmedPercent(4, 3)).toBe(75);
    expect(confirmedPercent(3, 1)).toBe(33);
    expect(confirmedPercent(3, 2)).toBe(67);
    expect(confirmedPercent(10, 10)).toBe(100);
    expect(confirmedPercent(10, 0)).toBe(0);
  });

  it('is 0 for an empty menu and never leaves 0 to 100', () => {
    expect(confirmedPercent(0, 0)).toBe(0);
    expect(confirmedPercent(-5, 2)).toBe(0);
    expect(confirmedPercent(NaN, 2)).toBe(0);
    expect(confirmedPercent(4, 9)).toBe(100);
    expect(confirmedPercent(4, -3)).toBe(0);
    expect(confirmedPercent(4, NaN)).toBe(0);
  });
});

describe('menuSummaryText', () => {
  it('an empty menu invites the owner to add one, and a chain is told its menu is empty', () => {
    expect(menuSummaryText(0, 0, false)).toEqual({
      count: 'No menu items yet', line: 'Your menu is empty. Pick a way to add it below.', tone: 'empty',
    });
    expect(menuSummaryText(0, 0, true).line).toBe('The chain menu has no items yet.');
  });

  it('counts the items and says how many are confirmed', () => {
    expect(menuSummaryText(31, 27, false)).toEqual({ count: '31 menu items', line: '27 confirmed · 4 need confirming', tone: 'warn' });
  });

  it('uses the singular for one item', () => {
    expect(menuSummaryText(1, 0, false).count).toBe('1 menu item');
    expect(menuSummaryText(1, 0, false).line).toBe('0 confirmed · 1 need confirming');
  });

  it('says all confirmed when nothing is left to confirm', () => {
    expect(menuSummaryText(12, 12, false)).toEqual({ count: '12 menu items', line: '✓ All confirmed', tone: 'good' });
    expect(menuSummaryText(12, 99, false).tone).toBe('good');   // more "confirmed" than items is treated as all
  });
});

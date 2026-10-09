import { confirmableSelection, confirmSelectedQuestion, toggleUnconfirmedSelection, unconfirmedIndices } from './menuSelection';

const items = [
  { isVerified: true, itemId: 'a' },
  { isVerified: false, itemId: 'b' },
  { isVerified: null, itemId: null },   // a row just typed: confirmed when the menu is saved
  { isVerified: false, itemId: 'd' },
  { isVerified: false, itemId: null },  // (cannot be confirmed yet: not saved)
];

describe('unconfirmedIndices', () => {
  it('lists the saved items that are not confirmed', () => {
    expect(unconfirmedIndices(items)).toEqual([1, 3]);
    expect(unconfirmedIndices([])).toEqual([]);
    expect(unconfirmedIndices([{ isVerified: true, itemId: 'x' }])).toEqual([]);
  });
});

describe('toggleUnconfirmedSelection', () => {
  it('ticks every unconfirmed item and keeps what was ticked', () => {
    expect([...toggleUnconfirmedSelection(new Set([0]), items)].sort()).toEqual([0, 1, 3]);
  });

  it('unticks just the unconfirmed ones when they are all ticked already', () => {
    expect([...toggleUnconfirmedSelection(new Set([0, 1, 3]), items)]).toEqual([0]);
  });

  it('ticks the rest when only some are ticked', () => {
    expect([...toggleUnconfirmedSelection(new Set([1]), items)].sort()).toEqual([1, 3]);
  });

  it('does nothing when there are no unconfirmed items, and does not change the original set', () => {
    const original = new Set([0]);
    const none = [{ isVerified: true, itemId: 'a' }];
    expect([...toggleUnconfirmedSelection(original, none)]).toEqual([0]);
    toggleUnconfirmedSelection(original, items);
    expect([...original]).toEqual([0]);
  });
});

describe('confirmableSelection', () => {
  it('returns only the ticked, saved, unconfirmed items', () => {
    expect(confirmableSelection(items, new Set([0, 1, 2, 3, 4]))).toEqual({ indices: [1, 3], itemIds: ['b', 'd'] });
    expect(confirmableSelection(items, new Set([0, 2]))).toEqual({ indices: [], itemIds: [] });
    expect(confirmableSelection(items, new Set())).toEqual({ indices: [], itemIds: [] });
  });
});

describe('confirmSelectedQuestion', () => {
  it('says how many, singular and plural', () => {
    expect(confirmSelectedQuestion(1)).toMatch(/^1 item will be marked as confirmed.*see it as real/);
    expect(confirmSelectedQuestion(5)).toMatch(/^5 items will be marked as confirmed.*see them as real/);
    expect(confirmSelectedQuestion(5)).toMatch(/Continue\?$/);
  });
});

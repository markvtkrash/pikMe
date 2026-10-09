import { toggleUnverifiedSelection, unverifiedIds, verifiableSelection, verifySelectedQuestion } from './menuEditSelection';

const rows = [
  { item_id: 'a', is_verified: true },
  { item_id: 'b', is_verified: false },
  { item_id: 'c', is_verified: false },
  { item_id: 'd', is_verified: true },
];

describe('unverifiedIds', () => {
  it('lists the items that are not verified', () => {
    expect(unverifiedIds(rows)).toEqual(['b', 'c']);
    expect(unverifiedIds([])).toEqual([]);
  });
});

describe('toggleUnverifiedSelection', () => {
  it('ticks every unverified item and keeps what was ticked', () => {
    expect([...toggleUnverifiedSelection(new Set(['a']), rows)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('unticks just the unverified ones when they are all ticked', () => {
    expect([...toggleUnverifiedSelection(new Set(['a', 'b', 'c']), rows)]).toEqual(['a']);
  });

  it('ticks the rest when only some are ticked', () => {
    expect([...toggleUnverifiedSelection(new Set(['b']), rows)].sort()).toEqual(['b', 'c']);
  });

  it('does nothing when everything is verified, and leaves the original set alone', () => {
    const original = new Set(['a']);
    expect([...toggleUnverifiedSelection(original, [{ item_id: 'a', is_verified: true }])]).toEqual(['a']);
    toggleUnverifiedSelection(original, rows);
    expect([...original]).toEqual(['a']);
  });
});

describe('verifiableSelection', () => {
  it('returns only the ticked items that are unverified', () => {
    expect(verifiableSelection(rows, new Set(['a', 'b', 'c', 'd']))).toEqual(['b', 'c']);
    expect(verifiableSelection(rows, new Set(['a', 'd']))).toEqual([]);
    expect(verifiableSelection(rows, new Set())).toEqual([]);
  });
});

describe('verifySelectedQuestion', () => {
  it('says how many', () => {
    expect(verifySelectedQuestion(1)).toMatch(/^1 item will be marked as verified.*see it as real/);
    expect(verifySelectedQuestion(3)).toMatch(/^3 items will be marked as verified.*see them as real/);
  });
});

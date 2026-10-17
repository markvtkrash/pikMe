import {
  DISTANCE_BAND_METERS, ESTIMATED_BADGE, MENU_EMPTY_BODY, MENU_EMPTY_TITLE, MENU_SOON_LINE, MENU_SOON_NOTE, menuBadge, menuComingSoonNote, showNutritionFor, sortByDistanceAndMenu,
  type MenuStatus,
} from './menuStatus';

describe('menuBadge', () => {
  it('says confirmed for a confirmed menu', () => {
    expect(menuBadge('confirmed')).toEqual({ label: '✓ Menu confirmed', tone: 'confirmed' });
  });
  it('says "Estimated menu · tap to see" when there are only estimated items', () => {
    expect(menuBadge('estimated')).toEqual({ label: 'Estimated menu · tap to see', tone: 'estimated' });
  });
  it('says the same when there are no items yet, because a tap shows an estimate either way', () => {
    expect(menuBadge('none')).toEqual(menuBadge('estimated'));
    expect(menuBadge('none')!.label).toBe(ESTIMATED_BADGE);
  });
  it('keeps the word "estimated" and invites the tap', () => {
    expect(ESTIMATED_BADGE).toMatch(/estimated/i);
    expect(ESTIMATED_BADGE).toMatch(/tap to see/i);
  });
  it('shows nothing when the status is unknown (an older server)', () => {
    expect(menuBadge(undefined)).toBeNull();
    expect(menuBadge(null)).toBeNull();
  });
  it('never calls an unconfirmed menu "confirmed"', () => {
    expect(menuBadge('estimated')!.label).not.toMatch(/confirmed/i);
    expect(menuBadge('none')!.label).not.toMatch(/confirmed/i);
  });
  it('keeps the label short enough for a card', () => {
    for (const s of ['confirmed', 'estimated', 'none'] as MenuStatus[]) expect(menuBadge(s)!.label.length).toBeLessThanOrEqual(30);
  });
});

describe('sortByDistanceAndMenu', () => {
  const r = (name: string, distanceMeters: number, menuStatus?: MenuStatus) => ({ name, distanceMeters, menuStatus });
  const names = (list: { name: string }[]) => list.map((x) => x.name);

  it('puts a confirmed menu first among restaurants about the same distance away', () => {
    const out = sortByDistanceAndMenu([r('none', 100, 'none'), r('est', 200, 'estimated'), r('conf', 300, 'confirmed')]);
    expect(names(out)).toEqual(['conf', 'est', 'none']);
  });
  it('keeps distance order inside the same menu status', () => {
    const out = sortByDistanceAndMenu([r('b', 400, 'confirmed'), r('a', 100, 'confirmed'), r('c', 700, 'confirmed')]);
    expect(names(out)).toEqual(['a', 'b', 'c']);
  });
  it('never puts a much closer restaurant behind a far one for its menu', () => {
    const near = r('near-none', 100, 'none');
    const far = r('far-conf', DISTANCE_BAND_METERS * 3, 'confirmed');
    expect(names(sortByDistanceAndMenu([far, near]))).toEqual(['near-none', 'far-conf']);
  });
  it('orders the bands by distance', () => {
    const out = sortByDistanceAndMenu([r('band2', 1700, 'confirmed'), r('band1', 900, 'none'), r('band0', 50, 'none')]);
    expect(names(out)).toEqual(['band0', 'band1', 'band2']);
  });
  it('the band edge: just under stays in the first band, exactly on it is the next', () => {
    const out = sortByDistanceAndMenu([r('next', DISTANCE_BAND_METERS, 'confirmed'), r('first', DISTANCE_BAND_METERS - 1, 'none')]);
    expect(names(out)).toEqual(['first', 'next']);
  });
  it('keeps pure distance order when no status is known (an older server)', () => {
    const out = sortByDistanceAndMenu([r('c', 300), r('a', 100), r('b', 200)]);
    expect(names(out)).toEqual(['a', 'b', 'c']);
  });
  it('treats unknown like estimated: after confirmed, before no menu, within a band', () => {
    const out = sortByDistanceAndMenu([r('none', 100, 'none'), r('unknown', 200), r('conf', 300, 'confirmed')]);
    expect(names(out)).toEqual(['conf', 'unknown', 'none']);
  });
  it('is stable for equal distance and status, and does not change the input', () => {
    const input = [r('x', 100, 'confirmed'), r('y', 100, 'confirmed'), r('z', 100, 'confirmed')];
    const copy = [...input];
    expect(names(sortByDistanceAndMenu(input))).toEqual(['x', 'y', 'z']);
    expect(input).toEqual(copy);
  });
  it('copes with an empty list', () => {
    expect(sortByDistanceAndMenu([])).toEqual([]);
  });
});

describe('showNutritionFor', () => {
  it('shows nutrition only for a confirmed item', () => {
    expect(showNutritionFor({ isVerified: true })).toBe(true);
    expect(showNutritionFor({ isVerified: false })).toBe(false);
    expect(showNutritionFor({ isVerified: null })).toBe(false);
    expect(showNutritionFor({})).toBe(false);
  });
});

describe('menuComingSoonNote', () => {
  it('shows while there are items and none is confirmed', () => {
    expect(menuComingSoonNote([{ isVerified: false }, { isVerified: false }])).toBe(MENU_SOON_NOTE);
    expect(menuComingSoonNote([{ isVerified: null }, {}])).toBe(MENU_SOON_NOTE);
  });
  it('is gone once one item is confirmed', () => {
    expect(menuComingSoonNote([{ isVerified: false }, { isVerified: true }])).toBeNull();
    expect(menuComingSoonNote([{ isVerified: true }])).toBeNull();
  });
  it('is not shown when there are no items (the empty state says it instead)', () => {
    expect(menuComingSoonNote([])).toBeNull();
  });
  it('says the items are estimated and may not be offered', () => {
    expect(MENU_SOON_NOTE).toMatch(/estimated/i);
    expect(MENU_SOON_NOTE).toMatch(/may not be offered/i);
  });
});

describe('the short line on the menu page', () => {
  it('is short, says estimated and not confirmed, and the full wording is kept for the details', () => {
    expect(MENU_SOON_LINE.length).toBeLessThanOrEqual(40);
    expect(MENU_SOON_LINE).toMatch(/estimated/i);
    expect(MENU_SOON_LINE).toMatch(/not confirmed/i);
    expect(MENU_SOON_NOTE.length).toBeGreaterThan(MENU_SOON_LINE.length);
  });
});

describe('the empty state', () => {
  it('says the menu is coming soon, with no "chain" wording', () => {
    expect(MENU_EMPTY_TITLE).toMatch(/coming soon/i);
    expect(`${MENU_EMPTY_TITLE} ${MENU_EMPTY_BODY}`).not.toMatch(/chain/i);
  });
});

import { normalizeLayout, resolveLayout, withGridSpacer, tileIcons } from './menuLayout';

describe('normalizeLayout', () => {
  it('accepts the two layouts and nothing else', () => {
    expect(normalizeLayout('list')).toBe('list');
    expect(normalizeLayout('grid')).toBe('grid');
    expect(normalizeLayout('table')).toBeNull();
    expect(normalizeLayout(null)).toBeNull();
    expect(normalizeLayout(undefined)).toBeNull();
    expect(normalizeLayout(3)).toBeNull();
  });
});

describe('resolveLayout', () => {
  it('uses the saved choice', () => {
    expect(resolveLayout('list')).toBe('list');
    expect(resolveLayout('grid')).toBe('grid');
  });
  it('without a choice: the list (Detailed), on every screen size', () => {
    expect(resolveLayout(null)).toBe('list');
  });
});

describe('withGridSpacer', () => {
  it('leaves an even number of tiles alone', () => {
    expect(withGridSpacer([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(withGridSpacer([])).toEqual([]);
  });
  it('adds one spacer after an odd number of tiles so the last one keeps its half width', () => {
    expect(withGridSpacer([1, 2, 3])).toEqual([1, 2, 3, { _spacer: true }]);
    expect(withGridSpacer([1])).toEqual([1, { _spacer: true }]);
  });
  it('does nothing for a single column', () => {
    expect(withGridSpacer([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });
  it('does not change the list it is given', () => {
    const items = [1, 2, 3];
    withGridSpacer(items);
    expect(items).toEqual([1, 2, 3]);
  });
});

describe('tileIcons', () => {
  const none = { warnings: false, noticeTag: null, fit: false, coupons: 0 };
  it('shows nothing when there is nothing to flag', () => {
    expect(tileIcons(none)).toEqual([]);
  });
  it('shows each status, most important first', () => {
    const icons = tileIcons({ warnings: true, noticeTag: '⚠ Unconfirmed', fit: true, coupons: 2 });
    expect(icons.map((i) => i.icon)).toEqual(['🚫', '⚠', '👍', '⭐']);
    expect(icons[3].label).toBe('Has 2 coupons');
  });
  it('tells AI-estimated and unconfirmed apart', () => {
    expect(tileIcons({ ...none, noticeTag: '🤖 AI-estimated' })[0]).toEqual({ icon: '🤖', label: 'AI-estimated item' });
    expect(tileIcons({ ...none, noticeTag: '⚠ Unconfirmed' })[0]).toEqual({ icon: '⚠', label: 'Unconfirmed item' });
  });
  it('labels a single coupon in the singular', () => {
    expect(tileIcons({ ...none, coupons: 1 })[0].label).toBe('Has a coupon');
  });
});

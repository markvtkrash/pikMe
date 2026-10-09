import { reachableCouponCount } from './couponVisibility';

describe('reachableCouponCount', () => {
  const shown = new Set(['a', 'b']);

  it('counts any-item coupons and coupons on shown items', () => {
    expect(reachableCouponCount([{ menu_item_id: null }, { menu_item_id: 'a' }, { menu_item_id: 'b' }, {}], shown)).toBe(4);
  });

  it('does not count a coupon on an item that is not shown', () => {
    expect(reachableCouponCount([{ menu_item_id: 'a' }, { menu_item_id: 'hidden' }], shown)).toBe(1);
    expect(reachableCouponCount([{ menu_item_id: 'hidden' }], shown)).toBe(0);
  });

  it('is zero with no coupons, and counts only any-item coupons when no items are shown', () => {
    expect(reachableCouponCount([], shown)).toBe(0);
    expect(reachableCouponCount([{ menu_item_id: 'a' }, { menu_item_id: null }], new Set())).toBe(1);
  });
});

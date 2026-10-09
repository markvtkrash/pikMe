// Which coupons a customer can actually reach on a restaurant's page. An any-item coupon is always reachable (through the
// Coupons button); an item coupon is only reachable when its item is on the menu the customer sees. A coupon on an item
// that is not shown (for example an unconfirmed item hidden once the menu has confirmed items) is not counted, so the
// Coupons button never promises a coupon that "Coupons only" cannot show.

export interface CouponLike {
  menu_item_id?: string | null;
}

export function reachableCouponCount(coupons: CouponLike[], shownItemIds: Set<string>): number {
  let n = 0;
  for (const c of coupons) {
    if (!c.menu_item_id || shownItemIds.has(c.menu_item_id)) n += 1;
  }
  return n;
}

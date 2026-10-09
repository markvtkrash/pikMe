// What admin_delete_restaurant (migration 091) reports, and the plain-language text for the
// confirm window on Manage Restaurants.
export interface RestaurantDeleteCounts {
  dryRun: boolean;
  restaurant: string;
  coupons: number;
  couponActivations: number;
  ownerMenuItems: number;
  supportTickets: number;
  relocationRequests: number;
  locationMenuItems: number;
  sharedMenuItems: number;
  sharedMenuKept: boolean;
  savedCopies: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Lines listing what will be removed (only the kinds that exist).
export function describeDeleteCounts(c: RestaurantDeleteCounts): string[] {
  const lines: string[] = [];
  if (c.coupons > 0) {
    lines.push(
      `${plural(c.coupons, 'coupon', 'coupons')}` +
        (c.couponActivations > 0 ? ` (${plural(c.couponActivations, 'customer activation', 'customer activations')})` : ''),
    );
  }
  if (c.ownerMenuItems > 0) lines.push(plural(c.ownerMenuItems, "owner menu entry", 'owner menu entries'));
  const menuRows = c.locationMenuItems + c.sharedMenuItems;
  if (menuRows > 0) {
    lines.push(
      plural(menuRows, 'menu item', 'menu items') +
        (c.savedCopies > 0 ? ` (${plural(c.savedCopies, 'saved copy', 'saved copies')} in customers\' lists)` : ''),
    );
  }
  if (c.supportTickets > 0) lines.push(plural(c.supportTickets, 'support ticket', 'support tickets'));
  if (c.relocationRequests > 0) lines.push(plural(c.relocationRequests, 'relocation request', 'relocation requests'));
  return lines;
}

// The whole confirm message. Always says what is kept, so nobody expects the owner login or the
// shared chain menu to disappear.
export function buildDeleteMessage(c: RestaurantDeleteCounts): string {
  const lines = describeDeleteCounts(c);
  const removed = lines.length > 0 ? `This permanently removes:\n• ${lines.join('\n• ')}` : 'It has no coupons or menu items of its own.';
  const kept = [
    'The owner login is kept.',
    c.sharedMenuKept ? 'The shared menu for this name is kept (other locations or a chain use it).' : null,
  ].filter(Boolean).join(' ');
  return `${c.restaurant} will be deleted and its Google place can be claimed again. ${removed}\n\n${kept} This cannot be undone.`;
}

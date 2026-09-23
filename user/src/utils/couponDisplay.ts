import type { Coupon } from '../types';

export function remainingPersonalUses(coupon: Coupon): number {
  return Math.max(0, coupon.per_user_limit - coupon.user_uses_count);
}

export function remainingTotalUses(coupon: Coupon): number | null {
  if (coupon.usage_limit == null) return null;
  return Math.max(0, coupon.usage_limit - coupon.times_used);
}

// Flat floor of 5, or 20% of the total limit if that's bigger -- keeps a
// size-10 coupon and a size-200 coupon both showing urgency at a meaningful
// point instead of one fixed number working for every limit size.
export function isLowStock(coupon: Coupon): boolean {
  const remaining = remainingTotalUses(coupon);
  if (remaining === null) return false;
  const threshold = Math.max(5, Math.ceil((coupon.usage_limit ?? 0) * 0.2));
  return remaining <= threshold;
}

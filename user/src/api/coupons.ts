import { supabase } from './supabase';
import type { Coupon } from '../types';

// Customer-facing coupon functions, split out of the original restaurantAuth.ts
// (which mixed these in with restaurant-owner management functions — a
// misnomer that made the file harder to reason about once the app split into
// separate customer and owner/admin codebases).

export async function getActiveCouponsForRestaurant(restaurantId: string): Promise<Coupon[]> {
  const { data, error } = await supabase.rpc('get_active_coupons_for_restaurant', {
    p_restaurant_id: restaurantId,
  });

  if (error) throw error;
  return data || [];
}

export interface ActivateCouponResult {
  activatedAt: string;
  expiresAt: string;
  alreadyActive: boolean;
}

// Idempotent: calling this again for a coupon the user already activated just
// returns the existing countdown window instead of burning a second use.
export async function activateCoupon(couponId: string): Promise<ActivateCouponResult> {
  const { data, error } = await supabase.rpc('activate_coupon', { p_coupon_id: couponId });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    alreadyActive: row.already_active,
  };
}

// Safe to call even after the countdown has expired — the use was already
// burned at activation, so closing early or late has no effect on usage_limit.
export async function closeCouponActivation(couponId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('close_coupon_activation', { p_coupon_id: couponId });
  if (error) throw error;
  return data as boolean;
}

export async function getActiveCouponsByPlaceId(googlePlaceId: string): Promise<Coupon[]> {
  // maybeSingle() returns null (200) for unclaimed restaurants instead of a
  // noisy 406 that .single() throws when zero rows match.
  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id')
    .eq('google_place_id', googlePlaceId)
    .maybeSingle();

  if (restaurantError || !restaurant) return [];

  return getActiveCouponsForRestaurant(restaurant.id);
}

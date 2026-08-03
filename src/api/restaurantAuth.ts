import { supabase } from './supabase';
import type { Coupon } from '../types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
  formattedAddress: string;
}

// Turns a free-text zip code/city/address into coordinates via the
// restaurant-search edge function (which calls Google's Geocoding API).
// Used by the owner claim flow so it can then call the exact same
// fetchNearbyRestaurants() customers use — guaranteeing an owner can only
// claim a restaurant that a customer searching from that same location would
// actually be able to discover, instead of an unconstrained global search.
export async function geocodeLocation(query: string): Promise<GeocodedLocation> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/restaurant-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

export async function signUpRestaurantOwner(email: string, password: string, businessName: string) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/restaurant-auth-signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, businessName }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

export async function adminCreateRestaurantOwner(params: {
  email: string;
  password: string;
  businessName: string;
  googlePlaceId: string;
  restaurantName: string;
  address: string;
  accessToken: string;
}) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-create-owner`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({
      email: params.email,
      password: params.password,
      businessName: params.businessName,
      googlePlaceId: params.googlePlaceId,
      restaurantName: params.restaurantName,
      address: params.address,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to create owner account');
  return data;
}

export async function loginRestaurantOwner(email: string, password: string) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/restaurant-auth-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

export async function claimRestaurant(
  googlePlaceId: string,
  restaurantName: string,
  address: string,
  token: string
) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/restaurant-claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ googlePlaceId, restaurantName, address }),
  });

  const data = await response.json();
  console.log('[claim] Response status:', response.status, 'Data:', JSON.stringify(data, null, 2));

  if (!response.ok) {
    const errorMsg = data.error || data.message || JSON.stringify(data);
    console.error('[claim] Error:', errorMsg);
    throw new Error(errorMsg);
  }
  return data;
}

export async function getRestaurantForOwner() {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('restaurants')
    .select('*')
    .eq('owner_id', user.user.id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function createCoupon(params: {
  restaurantId: string;
  couponType: 'item_percent' | 'item_fixed' | 'generic_percent' | 'generic_fixed';
  discountValue: number;
  couponCode: string;
  expiryDate: string;
  menuItemId?: string;
  usageLimit?: number;
  conditions?: Record<string, any>;
}) {
  console.log('[ai-request] createCoupon params:', JSON.stringify(params, null, 2));

  const { data, error } = await supabase.rpc('create_coupon', {
    p_restaurant_id: params.restaurantId,
    p_coupon_type: params.couponType,
    p_discount_value: params.discountValue,
    p_coupon_code: params.couponCode,
    p_expiry_date: params.expiryDate,
    p_menu_item_id: params.menuItemId || null,
    p_usage_limit: params.usageLimit || null,
    p_conditions: params.conditions || null,
  });

  if (error) {
    console.error('[ai-request] createCoupon error:', JSON.stringify(error, null, 2));
    throw error;
  }
  return data;
}

export async function updateCoupon(
  couponId: string,
  params: {
    couponType?: string;
    discountValue?: number;
    couponCode?: string;
    expiryDate?: string;
    menuItemId?: string;
    usageLimit?: number;
    conditions?: Record<string, any>;
    isActive?: boolean;
  }
) {
  const { data, error } = await supabase.rpc('update_coupon', {
    p_coupon_id: couponId,
    p_coupon_type: params.couponType || null,
    p_discount_value: params.discountValue || null,
    p_coupon_code: params.couponCode || null,
    p_expiry_date: params.expiryDate || null,
    p_menu_item_id: params.menuItemId || null,
    p_usage_limit: params.usageLimit || null,
    p_conditions: params.conditions || null,
    p_is_active: params.isActive !== undefined ? params.isActive : null,
  });

  if (error) throw error;
  return data;
}

export async function deleteCoupon(couponId: string) {
  const { data, error } = await supabase.rpc('delete_coupon', {
    p_coupon_id: couponId,
  });

  if (error) throw error;
  return data;
}

export async function getRestaurantCoupons(restaurantId: string) {
  const { data, error } = await supabase.rpc('get_restaurant_coupons', {
    p_restaurant_id: restaurantId,
  });

  if (error) throw error;
  return data || [];
}

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

export async function getActiveCouponsByPlaceId(googlePlaceId: string) {
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

export async function getRestaurantMenuItems(restaurantId: string) {
  const { data, error } = await supabase
    .from('restaurant_menu_items')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function refreshRestaurantMenu(restaurantId: string, restaurantName: string, authToken: string) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/refresh-restaurant-menu`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ restaurantId, restaurantName }),
  });

  const data = await response.json();
  console.log('[ai-request] refreshRestaurantMenu response:', JSON.stringify({ status: response.status, data }, null, 2));
  if (!response.ok) throw new Error(data.error || JSON.stringify(data));
  return data;
}

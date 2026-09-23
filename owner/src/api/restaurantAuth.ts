import { supabase } from './supabase';
import type { Restaurant } from '../types';

// Owner/admin-only functions, split out of the original restaurantAuth.ts
// (which mixed these in with customer-facing coupon functions — those now
// live in the separate customer app's src/api/coupons.ts).

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
  formattedAddress: string;
}

export interface RelocationEligibility {
  eligible: boolean;
  reason: 'pending_request' | 'cooldown' | null;
  retry_after: string | null;
}

export async function getRelocationEligibility(restaurantId: string): Promise<RelocationEligibility | null> {
  const { data, error } = await supabase.rpc('get_relocation_eligibility', {
    p_restaurant_id: restaurantId,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function requestRestaurantRelocation(params: {
  restaurantId: string;
  newGooglePlaceId: string;
  newName: string;
  newAddress: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('request_restaurant_relocation', {
    p_restaurant_id: params.restaurantId,
    p_new_google_place_id: params.newGooglePlaceId,
    p_new_name: params.newName,
    p_new_address: params.newAddress,
  });
  if (error) throw error;
  return data as string;
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

// Finds a restaurant by NAME (via Google Places Text Search) within a given
// radius of a geocoded location — for the case where Nearby Search's
// prominence-ranked browse doesn't surface it (a real but less-reviewed
// local restaurant can miss that top-~20 cutoff entirely). Still bounded to
// radiusMeters of a real location, same trust guarantee as the plain nearby
// browse — this only changes how the match happens, not whether it's
// location-constrained.
export async function searchRestaurantByName(
  businessName: string,
  latitude: number,
  longitude: number,
  radiusMeters: number
): Promise<Restaurant[]> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/restaurant-name-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName, latitude, longitude, radiusMeters }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to search by business name');
  return data.results || [];
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
  // Max times the SAME customer may redeem this coupon (usageLimit above
  // stays the combined cap across all customers). Defaults to 1 — the
  // once-per-customer behavior every coupon had before this field existed.
  perUserLimit?: number;
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
    p_per_user_limit: params.perUserLimit || 1,
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
    // Max times the SAME customer may redeem this coupon. Omit to leave
    // unchanged.
    perUserLimit?: number;
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
    p_per_user_limit: params.perUserLimit || null,
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

export interface RedemptionsOverTimeRow {
  week_start: string;
  redemption_count: number;
}

export async function getRedemptionsOverTime(restaurantId: string): Promise<RedemptionsOverTimeRow[]> {
  const { data, error } = await supabase.rpc('owner_report_redemptions_over_time', {
    p_restaurant_id: restaurantId,
  });
  if (error) throw error;
  return data || [];
}

export interface CouponStatusSnapshot {
  active_count: number;
  inactive_count: number;
  expired_count: number;
  orphaned_count: number;
}

export async function getCouponStatusSnapshot(restaurantId: string): Promise<CouponStatusSnapshot | null> {
  const { data, error } = await supabase.rpc('owner_report_coupon_status_snapshot', {
    p_restaurant_id: restaurantId,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export interface TopCouponRow {
  coupon_id: string;
  coupon_code: string;
  coupon_type: string;
  discount_value: number;
  usage_limit: number | null;
  times_used: number;
  redemption_count: number;
}

export async function getTopCoupons(restaurantId: string, limit = 10): Promise<TopCouponRow[]> {
  const { data, error } = await supabase.rpc('owner_report_top_coupons', {
    p_restaurant_id: restaurantId,
    p_limit: limit,
  });
  if (error) throw error;
  return data || [];
}

// Reads from menu_items — the same cache the consumer app's recommendation
// engine reads from — so the owner sees exactly what customers see, instead
// of a separately-drifting restaurant_menu_items copy.
export async function getRestaurantMenuItems(restaurantName: string) {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .ilike('restaurant_name', `%${restaurantName.split(' ')[0]}%`)
    .order('cached_at', { ascending: false });

  if (error) throw error;
  return (data || [])
    .map((row) => ({
      id: row.item_id,
      item_id: row.item_id,
      name: row.name,
      calories: row.calories,
      protein_g: row.protein_g,
      is_verified: row.is_verified,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Flips is_verified on a single item in place — no id change, no effect on
// any coupon tied to it. Use this for "this one AI guess is actually
// correct" instead of retyping it through the full manual-menu replace flow.
// An optional newName lets the owner fix a slightly-wrong name at the same
// time they confirm it, in one call.
export async function verifyMenuItem(itemId: string, newName?: string) {
  const { error } = await supabase.rpc('verify_menu_item', {
    p_item_id: itemId,
    p_new_name: newName?.trim() || null,
  });
  if (error) throw error;
}

// Reverts a mistaken verification back to unconfirmed — same single-row
// update, opposite direction.
export async function unverifyMenuItem(itemId: string) {
  const { error } = await supabase.rpc('unverify_menu_item', { p_item_id: itemId });
  if (error) throw error;
}

// Permanently removes a single wrong/unwanted item (e.g. a hallucinated AI
// guess) without touching the rest of the cached menu. Can come back with
// { requiresConfirmation: true, affectedCoupons } if an item-specific coupon
// points at this item — same shape/handling as refreshRestaurantMenu etc.,
// via confirmAndRetryIfNeeded.
export async function deleteMenuItem(itemId: string, force = false): Promise<MenuReplaceResult> {
  const { data, error } = await supabase.rpc('delete_menu_item', {
    p_item_id: itemId,
    p_force: force,
  });
  if (error) throw error;
  return data as MenuReplaceResult;
}

// Both of these can come back with { requiresConfirmation: true, affectedCoupons }
// instead of { success: true, itemCount } — that means replacing the cached
// items would orphan existing item-specific coupons. Callers must show that
// to the owner and re-call with force=true only if they choose to proceed.
export interface AffectedCoupon {
  id: string;
  couponCode: string;
}
export interface MenuReplaceResult {
  success?: boolean;
  itemCount?: number;
  requiresConfirmation?: boolean;
  affectedCoupons?: AffectedCoupon[];
  // Set when this replacement would downgrade real (link/manual) verified
  // items back into AI-guessed ones — independent of the coupon check above.
  overwritesVerifiedCount?: number;
  // Only present on refreshRestaurantMenu's result — true when it found and
  // used the restaurant's real website instead of falling back to a pure
  // AI guess.
  usedRealWebsite?: boolean;
  // Present alongside requiresConfirmation on the link/photo/text extraction
  // results — the items already extracted this call. Pass these back in on
  // the force:true retry (see the extractedItems param on those functions
  // below) so the retry doesn't re-run the underlying AI extraction from
  // scratch, which is both wasteful and non-deterministic enough to
  // legitimately come back with fewer/zero items the second time.
  items?: unknown[];
}

export async function refreshRestaurantMenu(
  restaurantId: string,
  restaurantName: string,
  authToken: string,
  force = false,
  onlyUnverified = false
): Promise<MenuReplaceResult> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/refresh-restaurant-menu`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ restaurantId, restaurantName, force, onlyUnverified }),
  });

  const data = await response.json();
  console.log('[ai-request] refreshRestaurantMenu response:', JSON.stringify({ status: response.status, data }, null, 2));
  if (!response.ok) throw new Error(data.error || JSON.stringify(data));
  return data;
}

// Saves the owner's real menu link and extracts real menu items from it,
// replacing whatever AI-guessed items were cached for this restaurant.
export async function updateRestaurantMenuLink(
  restaurantId: string,
  restaurantName: string,
  menuUrl: string,
  authToken: string,
  force = false,
  extractedItems?: unknown[]
): Promise<MenuReplaceResult> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-menu-from-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ restaurantId, restaurantName, menuUrl, force, items: extractedItems }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to extract menu from that link');
  return data;
}

// Owner uploads a photo of their real (printed/physical) menu — extracted
// with a vision model server-side. imageBase64 must be a data URL
// ("data:image/jpeg;base64,...").
export async function extractMenuFromImage(
  restaurantId: string,
  restaurantName: string,
  imageBase64: string,
  authToken: string,
  force = false,
  extractedItems?: unknown[]
): Promise<MenuReplaceResult> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-menu-from-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ restaurantId, restaurantName, imageBase64, force, items: extractedItems }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to extract menu from that photo');
  return data;
}

// Owner pastes raw menu text (copied from a PDF, email, doc, etc.) — a
// vision/scrape-free alternative to the link/photo paths, useful when the
// menu exists as text somewhere that isn't a clean webpage or a photo.
export async function extractMenuFromText(
  restaurantId: string,
  restaurantName: string,
  menuText: string,
  authToken: string,
  force = false,
  extractedItems?: unknown[]
): Promise<MenuReplaceResult> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-menu-from-text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ restaurantId, restaurantName, menuText, force, items: extractedItems }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to extract menu from that text');
  return data;
}

// For restaurants with no online menu to link — the owner types in the real
// item names directly, and the AI is only used to estimate nutrition for
// those confirmed-real names, never to invent dish existence.
export async function submitManualMenuItems(
  restaurantId: string,
  restaurantName: string,
  itemNames: string[],
  authToken: string,
  force = false
): Promise<MenuReplaceResult> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/estimate-menu-nutrition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ restaurantId, restaurantName, itemNames, force }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to save your menu items');
  return data;
}

export async function setRestaurantPaused(restaurantId: string, paused: boolean): Promise<void> {
  const { error } = await supabase.rpc('owner_set_restaurant_paused', {
    p_restaurant_id: restaurantId,
    p_paused: paused,
  });
  if (error) throw error;
}

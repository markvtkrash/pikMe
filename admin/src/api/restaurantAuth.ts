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

// Turns a free-text zip code/city/address into coordinates via the
// restaurant-search edge function (which calls Google's Geocoding API).
// Used by the owner claim flow so it can then call the exact same
// fetchNearbyRestaurants() customers use — guaranteeing an owner can only
// claim a restaurant that a customer searching from that same location would
// actually be able to discover, instead of an unconstrained global search.
// Requires a logged-in session — this hits a billable Google API, so the
// edge function rejects anonymous callers.
export async function geocodeLocation(query: string): Promise<GeocodedLocation> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Admin session expired. Please log in again.');

  const response = await fetch(`${SUPABASE_URL}/functions/v1/restaurant-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

// Finds a restaurant by NAME (via Google Places Text Search) within a given
// radius of a geocoded location — for the case where Nearby Search's
// prominence-ranked browse doesn't surface it (a real but less-reviewed
// local restaurant can miss that top-~20 cutoff entirely). Mirrors the owner
// claim flow's search of the same name — used here so Admin's Create
// Restaurant Owner can find anything an owner could find via Claim.
// Requires a logged-in session — this hits a billable Google API, so the
// edge function rejects anonymous callers.
export async function searchRestaurantByName(
  businessName: string,
  latitude: number,
  longitude: number,
  radiusMeters: number
): Promise<Restaurant[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Admin session expired. Please log in again.');

  const response = await fetch(`${SUPABASE_URL}/functions/v1/restaurant-name-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
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

export interface AdminOwnerRow {
  owner_id: string;
  business_name: string;
  email: string;
  is_active: boolean;
  restaurant_id: string | null;
  restaurant_name: string | null;
  restaurant_status: string | null;
  claimed_at: string | null;
}

export async function adminListOwners(): Promise<AdminOwnerRow[]> {
  const { data, error } = await supabase.rpc('admin_list_owners');
  if (error) throw error;
  return data || [];
}

export async function adminSetOwnerActive(ownerId: string, isActive: boolean) {
  const { error } = await supabase.rpc('admin_set_owner_active', {
    p_owner_id: ownerId,
    p_is_active: isActive,
  });
  if (error) throw error;
}

export async function adminSetRestaurantStatus(restaurantId: string, status: 'approved' | 'closed') {
  const { error } = await supabase.rpc('admin_set_restaurant_status', {
    p_restaurant_id: restaurantId,
    p_status: status,
  });
  if (error) throw error;
}

export async function adminUpdateOwner(params: {
  ownerId: string;
  businessName: string;
  email: string;
  accessToken: string;
}) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-update-owner`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({
      ownerId: params.ownerId,
      businessName: params.businessName,
      email: params.email,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to update owner');
  return data;
}

export async function adminReassignOwner(params: {
  restaurantId: string;
  newOwnerEmail: string;
  newOwnerPassword: string;
  newOwnerBusinessName: string;
  accessToken: string;
}) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-reassign-owner`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({
      restaurantId: params.restaurantId,
      newOwnerEmail: params.newOwnerEmail,
      newOwnerPassword: params.newOwnerPassword,
      newOwnerBusinessName: params.newOwnerBusinessName,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to reassign restaurant');
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

export interface RelocationRequest {
  id: string;
  restaurant_id: string;
  business_name: string;
  owner_email: string;
  old_name: string;
  old_address: string;
  new_name: string;
  new_address: string;
  requested_at: string;
}

export async function adminListRelocationRequests(): Promise<RelocationRequest[]> {
  const { data, error } = await supabase.rpc('admin_list_relocation_requests');
  if (error) throw error;
  return data || [];
}

export async function adminRejectRelocationRequest(requestId: string, adminNote?: string) {
  const { error } = await supabase.rpc('admin_reject_relocation_request', {
    p_request_id: requestId,
    p_admin_note: adminNote ?? null,
  });
  if (error) throw error;
}

export async function adminApproveRelocationRequest(params: {
  requestId: string;
  adminNote?: string;
  accessToken: string;
}) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-approve-relocation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({ requestId: params.requestId, adminNote: params.adminNote ?? null }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to approve relocation request');
  return data;
}

// ─── Menu Management (admin, on behalf of any claimed restaurant) ──────────
// Both extract-menu-from-* edge functions accept an admin caller (checked via
// user_roles) as an alternative to the restaurant's own owner — added
// specifically so Admin's Menu Management page can seed/update a menu for
// any restaurant without needing to sign in as that owner.

// Mirrors owner app's restaurantAuth.ts exactly — see there for the shape
// rationale (requiresConfirmation / affectedCoupons / overwritesVerifiedCount
// / items-for-retry).
export interface AffectedCoupon {
  id: string;
  couponCode: string;
}
export interface MenuReplaceResult {
  success?: boolean;
  itemCount?: number;
  requiresConfirmation?: boolean;
  affectedCoupons?: AffectedCoupon[];
  overwritesVerifiedCount?: number;
  items?: unknown[];
}

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

export interface ResetOwnerPasswordResult {
  email: string;
  temporaryPassword: string;
  mustChangePasswordFlagged: boolean;
}

// Admin-only: sets a temporary password on an owner's login. Pass
// `temporaryPassword` to use one the admin chose (it must meet the strength
// rules; the server rejects anything weaker); omit it and the server generates
// one. The password comes back once; the owner is made to change it at next login.
export async function adminResetOwnerPassword(params: {
  ownerId: string;
  accessToken: string;
  temporaryPassword?: string;
}): Promise<ResetOwnerPasswordResult> {
  const body: Record<string, unknown> = { ownerId: params.ownerId };
  if (params.temporaryPassword !== undefined) body.temporaryPassword = params.temporaryPassword;

  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-reset-owner-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to reset password');
  return data;
}

// Asks the server for a suggested strong password. Nothing is changed — the
// reset dialog shows it in an editable field and the admin applies it (or an
// edited version) with adminResetOwnerPassword.
export async function adminGenerateOwnerPassword(accessToken: string): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-reset-owner-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ generateOnly: true }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to generate a password');
  return data.temporaryPassword as string;
}

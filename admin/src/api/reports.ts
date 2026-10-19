import { supabase } from './supabase';
import type { HealthLocationRow } from '../utils/menuHealth';

export interface ClaimsOverTimeRow {
  week_start: string;
  status: string;
  claim_count: number;
}

export interface ClaimApprovalTime {
  approved_count: number;
  avg_hours: number | null;
  median_hours: number | null;
}

export interface RestaurantStatusRow {
  status: string;
  restaurant_count: number;
}

export interface RedemptionsOverTimeRow {
  week_start: string;
  redemption_count: number;
}

export interface CouponStatusSnapshot {
  active_count: number;
  inactive_count: number;
  expired_count: number;
  orphaned_count: number;
}

export interface TopCouponRow {
  coupon_id: string;
  coupon_code: string;
  restaurant_name: string;
  coupon_type: string;
  discount_value: number;
  usage_limit: number | null;
  times_used: number;
  redemption_count: number;
}

export async function getClaimsOverTime(): Promise<ClaimsOverTimeRow[]> {
  const { data, error } = await supabase.rpc('admin_report_claims_over_time');
  if (error) throw error;
  return data || [];
}

export async function getClaimApprovalTime(): Promise<ClaimApprovalTime | null> {
  const { data, error } = await supabase.rpc('admin_report_claim_approval_time');
  if (error) throw error;
  return data?.[0] || null;
}

export async function getRestaurantStatusSnapshot(): Promise<RestaurantStatusRow[]> {
  const { data, error } = await supabase.rpc('admin_report_restaurant_status_snapshot');
  if (error) throw error;
  return data || [];
}

export async function getRedemptionsOverTime(): Promise<RedemptionsOverTimeRow[]> {
  const { data, error } = await supabase.rpc('admin_report_redemptions_over_time');
  if (error) throw error;
  return data || [];
}

export async function getCouponStatusSnapshot(): Promise<CouponStatusSnapshot | null> {
  const { data, error } = await supabase.rpc('admin_report_coupon_status_snapshot');
  if (error) throw error;
  return data?.[0] || null;
}

export async function getTopCoupons(limit = 10): Promise<TopCouponRow[]> {
  const { data, error } = await supabase.rpc('admin_report_top_coupons', { p_limit: limit });
  if (error) throw error;
  return data || [];
}

export interface OwnerStatusSnapshot {
  active_count: number;
  inactive_count: number;
}

export interface OwnerNeedingAttention {
  owner_id: string;
  business_name: string;
  email: string;
  restaurant_id: string;
  restaurant_name: string;
  coupon_count: number;
  verified_item_count: number;
  zero_coupons: boolean;
  zero_verified_items: boolean;
}

export interface MenuHealthSnapshot {
  verified_count: number;
  unverified_count: number;
  restaurants_with_no_items_count: number;
  // Migration 137: how many restaurants the filter covers.
  restaurant_count: number;
}

export interface SupportSnapshotRow {
  ticket_type: string;
  status: string;
  ticket_count: number;
}

export interface SupportResolutionTime {
  resolved_count: number;
  avg_hours: number | null;
  median_hours: number | null;
}

export async function getOwnerStatusSnapshot(): Promise<OwnerStatusSnapshot | null> {
  const { data, error } = await supabase.rpc('admin_report_owner_status_snapshot');
  if (error) throw error;
  return data?.[0] || null;
}

export async function getOwnersNeedingAttention(): Promise<OwnerNeedingAttention[]> {
  const { data, error } = await supabase.rpc('admin_report_owners_needing_attention');
  if (error) throw error;
  return data || [];
}

// The Menu Data Health report is filtered on the server by region (state) and city (migration 137). A blank region means every
// region, and '__none__' means restaurants whose address has no readable state.
export interface MenuHealthFilter {
  state: string;
  city: string;
  // Migration 138: '' = claimed and city-imported restaurants, 'claimed', or 'city'.
  source?: string;
  // Migration 151: '' = franchise and independent, 'franchise', or 'independent'.
  franchise?: string;
  // Migration 152: true = only restaurants with zero menu items (folds in the old, separate
  // "no menu items" report); false/omitted = restaurants with at least one item, as before.
  noItems?: boolean;
  // Migration 155: a case-insensitive substring match on the restaurant name; '' or omitted = no search.
  search?: string;
}

function filterArgs(filter: MenuHealthFilter) {
  return {
    p_state: filter.state || null, p_city: filter.city || null, p_source: filter.source || null,
    p_franchise: filter.franchise || null, p_search: filter.search || null,
  };
}

export async function getMenuHealthSnapshot(filter: MenuHealthFilter): Promise<MenuHealthSnapshot | null> {
  const { data, error } = await supabase.rpc('admin_report_menu_health_snapshot', filterArgs(filter));
  if (error) throw error;
  return data?.[0] || null;
}

// The regions and cities that have restaurants, with counts, for the report's filter.
export async function getMenuHealthLocations(): Promise<HealthLocationRow[]> {
  const { data, error } = await supabase.rpc('admin_menu_health_locations');
  if (error) throw error;
  return (data ?? []) as HealthLocationRow[];
}

export async function getSupportSnapshot(): Promise<SupportSnapshotRow[]> {
  const { data, error } = await supabase.rpc('admin_report_support_snapshot');
  if (error) throw error;
  return data || [];
}

export async function getSupportResolutionTime(): Promise<SupportResolutionTime | null> {
  const { data, error } = await supabase.rpc('admin_report_support_resolution_time');
  if (error) throw error;
  return data?.[0] || null;
}

export interface MenuHealthByRestaurantRow {
  total_count: number;
  // Null for a city-imported restaurant (no owner); use place_id to tell rows apart.
  restaurant_id: string | null;
  restaurant_name: string;
  verified_count: number;
  unverified_count: number;
  place_id: string | null;
  address: string | null;
  is_franchise: boolean;
  // Migration 138.
  source: 'claimed' | 'city';
}

// A page of restaurants matching the filter's noItems flag (total_count is the whole filtered count) --
// at least one menu item by default, or (migration 152) only restaurants with zero items.
export async function getMenuHealthByRestaurant(filter: MenuHealthFilter, limit: number, offset: number): Promise<MenuHealthByRestaurantRow[]> {
  const { data, error } = await supabase.rpc('admin_report_menu_health_by_restaurant', {
    ...filterArgs(filter), p_limit: limit, p_offset: offset, p_no_items: !!filter.noItems,
  });
  if (error) throw error;
  return data || [];
}

export interface FranchiseRestaurantRow {
  place_id: string;
  restaurant_name: string;
  address: string | null;
  city: string | null;
  matched_franchise: string;
  franchise_category: string | null;
  cached_at: string;
}

export interface NonFranchiseRestaurantRow {
  place_id: string;
  restaurant_name: string;
  address: string | null;
  city: string | null;
  cuisine_types: string[] | null;
  cached_at: string;
}

// PostgREST caps a single response (1000 rows by default), and the cached
// restaurant list can be larger, so these two reports page through the RPC.
export async function fetchAllPages<T>(rpcName: string): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc(rpcName).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

export function getFranchiseRestaurants(): Promise<FranchiseRestaurantRow[]> {
  return fetchAllPages<FranchiseRestaurantRow>('admin_report_franchise_restaurants');
}

export function getNonFranchiseRestaurants(): Promise<NonFranchiseRestaurantRow[]> {
  return fetchAllPages<NonFranchiseRestaurantRow>('admin_report_non_franchise_restaurants');
}

export interface DeleteCachedRestaurantsResult {
  requested: number;
  deletedRestaurants: number;
  skippedClaimed: number;
  deletedSavedRestaurants: number;
  deletedMenuItems: number;
  deletedVerifiedMenuItems: number;
}

// Deletes the given cached restaurants plus the data that depends on them —
// see migration 064 for exactly what is and isn't removed.
export async function deleteCachedRestaurants(placeIds: string[]): Promise<DeleteCachedRestaurantsResult> {
  const { data, error } = await supabase.rpc('admin_delete_cached_restaurants', { p_place_ids: placeIds });
  if (error) throw error;
  return data as DeleteCachedRestaurantsResult;
}

export interface AgreementRow {
  user_id: string;
  email: string;
  agreement_type: string;
  version: string;
  agreed_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

// Every signup/consent agreement ever recorded, newest first — admin-only (migration 150).
export function getAllAgreements(): Promise<AgreementRow[]> {
  return fetchAllPages<AgreementRow>('admin_get_all_agreements');
}

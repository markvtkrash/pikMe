import { supabase } from './supabase';

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
}

export interface RestaurantNoMenuItems {
  restaurant_id: string;
  restaurant_name: string;
  status: string;
  claimed_at: string;
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

export async function getMenuHealthSnapshot(): Promise<MenuHealthSnapshot | null> {
  const { data, error } = await supabase.rpc('admin_report_menu_health_snapshot');
  if (error) throw error;
  return data?.[0] || null;
}

export async function getRestaurantsNoMenuItems(): Promise<RestaurantNoMenuItems[]> {
  const { data, error } = await supabase.rpc('admin_report_restaurants_no_menu_items');
  if (error) throw error;
  return data || [];
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
  restaurant_id: string;
  restaurant_name: string;
  verified_count: number;
  unverified_count: number;
}

export async function getMenuHealthByRestaurant(): Promise<MenuHealthByRestaurantRow[]> {
  const { data, error } = await supabase.rpc('admin_report_menu_health_by_restaurant');
  if (error) throw error;
  return data || [];
}

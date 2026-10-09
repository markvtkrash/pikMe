// The settings the customer app reads in ONE call (get_customer_config, migrations 127 and 128), turned into usable values, and
// the minimum-app-version rule. Every value has a safe default, so a failed or partial read never breaks the app.

import { Announcement, parseAnnouncements } from './announcements';
import { parseCategories, RestaurantCategory } from './categories';

export const DEFAULT_MAX_RADIUS_MILES = 6;

export interface CustomerConfig {
  maxRadiusMiles: number;
  showUnconfirmedMenuItems: boolean;
  // the oldest app version allowed to run; '0.0.0' allows every version
  minAppVersion: string;
  // the live in-app announcements for customers (migration 128)
  announcements: Announcement[];
  // the categories an admin offers: what a place is, how you get the food, what it serves (migration 129)
  categories: RestaurantCategory[];
}

export const DEFAULT_CUSTOMER_CONFIG: CustomerConfig = {
  maxRadiusMiles: DEFAULT_MAX_RADIUS_MILES,
  showUnconfirmedMenuItems: false,
  minAppVersion: '0.0.0',
  announcements: [],
  categories: [],
};

// `raw` is the object the database returned (text values), or anything else when the call failed.
export function parseCustomerConfig(raw: unknown): CustomerConfig {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const radius = Number(r.maxRadiusMiles);
  const min = typeof r.minAppVersion === 'string' && /^\d+(\.\d+){0,2}$/.test(r.minAppVersion.trim()) ? r.minAppVersion.trim() : '0.0.0';
  return {
    maxRadiusMiles: r.maxRadiusMiles != null && r.maxRadiusMiles !== '' && !Number.isNaN(radius) && radius > 0 ? radius : DEFAULT_MAX_RADIUS_MILES,
    showUnconfirmedMenuItems: r.showUnconfirmedMenuItems === 'true' || r.showUnconfirmedMenuItems === true,
    minAppVersion: min,
    announcements: parseAnnouncements(r.announcements),
    categories: parseCategories(r.categories),
  };
}

function parts(version: string): number[] {
  const nums = String(version ?? '').trim().split('.').map((p) => Number.parseInt(p, 10));
  return [0, 1, 2].map((i) => (Number.isFinite(nums[i]) ? nums[i] : 0));
}

// True when `current` is older than `minimum` (compared as major.minor.patch). An unreadable version is never "below", so
// a problem reading either value cannot lock people out.
export function isVersionBelow(current: string | null | undefined, minimum: string | null | undefined): boolean {
  if (!current || !minimum || !/^\d+(\.\d+){0,2}/.test(String(current).trim()) || !/^\d+(\.\d+){0,2}/.test(String(minimum).trim())) return false;
  const a = parts(current);
  const b = parts(minimum);
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

// The Delete button on the admin Manage Users page. Only an owner login can be deleted, and only when it has no restaurant and has been
// deactivated long enough (migration 132). A customer or an admin account never can. The server checks again before deleting.

export type UserRole = 'admin' | 'owner' | 'customer';

export interface DeletableUserInfo {
  user_id: string;
  role: UserRole;
}

export interface OwnerDeleteInfo {
  can_delete: boolean;
}

export function canDeleteUser(user: DeletableUserInfo, owners: Map<string, OwnerDeleteInfo>, currentUserId?: string | null): boolean {
  if (currentUserId && user.user_id === currentUserId) return false;
  if (user.role === 'owner') return owners.get(user.user_id)?.can_delete === true;
  return false;
}

export function deleteUserQuestion(email: string): { title: string; message: string } {
  return {
    title: 'Delete this owner login permanently?',
    message: `${email}\n\nThis permanently deletes the sign-in account. It cannot be undone.`,
  };
}

// ── Colour-coded tags on the Manage Users page ──────────────────────────────
export type Tone = 'good' | 'warn' | 'danger' | 'neutral';

export interface UserTag {
  label: string;
  tone: Tone;
}

export interface CleanupInfo {
  is_active: boolean;
  can_delete: boolean;
  deactivated_at: string | null;
  days_left: number | null;
}

const DAY_MS = 86_400_000;

export function wholeDaysSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// How recently the person used the app: green within 30 days, amber within 90, red after that or when they never signed in
// for over a month.
export function activityTag(lastSignInAt: string | null | undefined, createdAt: string | null | undefined, now: number = Date.now()): UserTag {
  const last = wholeDaysSince(lastSignInAt, now);
  if (last === null) {
    const joined = wholeDaysSince(createdAt, now);
    if (joined !== null && joined > 30) return { label: `Never signed in, joined ${plural(joined, 'day')} ago`, tone: 'danger' };
    return { label: 'Never signed in', tone: 'neutral' };
  }
  const label = last === 0 ? 'Active today' : `Active ${plural(last, 'day')} ago`;
  return { label, tone: last <= 30 ? 'good' : last <= 90 ? 'warn' : 'danger' };
}

// Where an owner login with no restaurant stands in the cleanup (migration 132). Null when the owner has a restaurant or the cleanup
// data is not available.
export function cleanupTag(role: UserRole, info: CleanupInfo | undefined, now: number = Date.now()): UserTag | null {
  if (role !== 'owner' || !info) return null;
  if (info.is_active) return { label: 'No restaurant, still active: deactivate first', tone: 'warn' };
  const since = wholeDaysSince(info.deactivated_at, now);
  const when = since === null ? 'deactivated' : `deactivated ${plural(since, 'day')} ago`;
  if (info.can_delete) return { label: `No restaurant, ${when}: ready to delete`, tone: 'danger' };
  if (info.days_left !== null && info.days_left > 0) return { label: `No restaurant, ${when}: ${plural(info.days_left, 'day')} left`, tone: 'warn' };
  return { label: `No restaurant, ${when}`, tone: 'neutral' };
}

export const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  good: { bg: '#E8F5E9', fg: '#2E7D32' },
  warn: { bg: '#FFF3E0', fg: '#BF360C' },
  danger: { bg: '#FFEBEE', fg: '#C62828' },
  neutral: { bg: '#ECEFF1', fg: '#455A64' },
};

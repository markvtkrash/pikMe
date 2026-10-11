import { canDeleteUser, deleteUserQuestion } from './userDelete';

const owners = new Map([['o1', { can_delete: true }], ['o2', { can_delete: false }]]);

describe('canDeleteUser', () => {
  it('never allows a customer', () => {
    expect(canDeleteUser({ user_id: 'c1', role: 'customer' }, owners)).toBe(false);
    expect(canDeleteUser({ user_id: 'c1', role: 'customer' }, new Map([['c1', { can_delete: true }]]))).toBe(false);
  });

  it('allows an owner only when the cleanup rules say so', () => {
    expect(canDeleteUser({ user_id: 'o1', role: 'owner' }, owners)).toBe(true);
    expect(canDeleteUser({ user_id: 'o2', role: 'owner' }, owners)).toBe(false);
    expect(canDeleteUser({ user_id: 'o3', role: 'owner' }, owners)).toBe(false);
  });

  it('never allows an admin or the signed-in user', () => {
    expect(canDeleteUser({ user_id: 'a1', role: 'admin' }, owners)).toBe(false);
    expect(canDeleteUser({ user_id: 'o1', role: 'owner' }, owners, 'o1')).toBe(false);
  });
});

describe('deleteUserQuestion', () => {
  it('names the email and says it cannot be undone', () => {
    const q = deleteUserQuestion('o@x.com');
    expect(q.title).toMatch(/owner login/);
    expect(q.message).toMatch(/o@x\.com/);
    expect(q.message).toMatch(/cannot be undone/);
  });
});

import { activityTag, cleanupTag, wholeDaysSince } from './userDelete';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe('wholeDaysSince', () => {
  it('counts whole days and tolerates bad input', () => {
    expect(wholeDaysSince(ago(3), NOW)).toBe(3);
    expect(wholeDaysSince(ago(0), NOW)).toBe(0);
    expect(wholeDaysSince(null, NOW)).toBeNull();
    expect(wholeDaysSince('nonsense', NOW)).toBeNull();
    expect(wholeDaysSince(new Date(NOW + 5 * 86_400_000).toISOString(), NOW)).toBe(0);
  });
});

describe('activityTag', () => {
  it('colours by how recently the person signed in', () => {
    expect(activityTag(ago(0), ago(100), NOW)).toEqual({ label: 'Active today', tone: 'good' });
    expect(activityTag(ago(10), ago(100), NOW)).toEqual({ label: 'Active 10 days ago', tone: 'good' });
    expect(activityTag(ago(1), ago(100), NOW).label).toBe('Active 1 day ago');
    expect(activityTag(ago(60), ago(200), NOW).tone).toBe('warn');
    expect(activityTag(ago(120), ago(200), NOW).tone).toBe('danger');
  });

  it('flags someone who never signed in', () => {
    expect(activityTag(null, ago(5), NOW)).toEqual({ label: 'Never signed in', tone: 'neutral' });
    expect(activityTag(null, ago(45), NOW)).toEqual({ label: 'Never signed in, joined 45 days ago', tone: 'danger' });
  });
});

describe('cleanupTag', () => {
  const base = { is_active: false, can_delete: false, deactivated_at: ago(12), days_left: 18 };

  it('is only for owners with cleanup data', () => {
    expect(cleanupTag('customer', base, NOW)).toBeNull();
    expect(cleanupTag('admin', base, NOW)).toBeNull();
    expect(cleanupTag('owner', undefined, NOW)).toBeNull();
  });

  it('tells an active owner to deactivate first', () => {
    expect(cleanupTag('owner', { ...base, is_active: true, deactivated_at: null, days_left: null }, NOW))
      .toEqual({ label: 'No restaurant, still active: deactivate first', tone: 'warn' });
  });

  it('shows the days left while waiting', () => {
    expect(cleanupTag('owner', base, NOW)).toEqual({ label: 'No restaurant, deactivated 12 days ago: 18 days left', tone: 'warn' });
    expect(cleanupTag('owner', { ...base, days_left: 1 }, NOW)?.label).toMatch(/1 day left$/);
  });

  it('shows when it is ready to delete', () => {
    expect(cleanupTag('owner', { ...base, deactivated_at: ago(40), can_delete: true, days_left: 0 }, NOW))
      .toEqual({ label: 'No restaurant, deactivated 40 days ago: ready to delete', tone: 'danger' });
  });
});

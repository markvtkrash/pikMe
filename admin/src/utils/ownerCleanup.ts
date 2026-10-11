// Cleaning up owner logins that have no restaurant (Manage Restaurants -> "No restaurant"): reading the list, choosing who to
// deactivate or delete, and the wording of the confirmation windows. The rules themselves live in the database (migration 132).

export interface RemovableOwner {
  owner_id: string;
  business_name: string;
  email: string;
  is_active: boolean;
  deactivated_at: string | null;
  created_at: string;
  open_tickets: number;
  resolved_tickets: number;
  can_delete: boolean;
  days_left: number | null;
  reason: string | null;
}

export function parseRemovableOwners(raw: unknown): RemovableOwner[] {
  if (!Array.isArray(raw)) return [];
  const out: RemovableOwner[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, any>;
    if (typeof r.owner_id !== 'string' || typeof r.email !== 'string') continue;
    out.push({
      owner_id: r.owner_id,
      business_name: String(r.business_name ?? ''),
      email: r.email,
      is_active: r.is_active !== false,
      deactivated_at: r.deactivated_at ?? null,
      created_at: String(r.created_at ?? ''),
      open_tickets: Number(r.open_tickets) || 0,
      resolved_tickets: Number(r.resolved_tickets) || 0,
      can_delete: r.can_delete === true,
      days_left: r.days_left == null ? null : Number(r.days_left),
      reason: r.reason ?? null,
    });
  }
  return out;
}

// The owners a bulk action applies to, from the ticked set.
export function deactivatableIds(rows: RemovableOwner[], selected: Set<string>): string[] {
  return rows.filter((r) => selected.has(r.owner_id) && r.is_active).map((r) => r.owner_id);
}
export function deletableIds(rows: RemovableOwner[], selected: Set<string>): string[] {
  return rows.filter((r) => selected.has(r.owner_id) && r.can_delete).map((r) => r.owner_id);
}

// "Select all": ticks every owner in the list; pressing it again when all are ticked clears the selection.
export function toggleSelectAll(rows: { owner_id: string }[], selected: Set<string>): Set<string> {
  const ids = rows.map((r) => r.owner_id);
  return ids.length > 0 && ids.every((id) => selected.has(id)) ? new Set() : new Set(ids);
}

export function toggleOne(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

// What to show under an owner in the list.
export function describeStatus(r: RemovableOwner): { label: string; tone: 'good' | 'warn' | 'neutral' } {
  if (r.is_active) return { label: 'Active, no restaurant', tone: 'warn' };
  if (r.can_delete) return { label: 'Deactivated, can be deleted', tone: 'good' };
  return { label: r.reason ? `Deactivated. ${r.reason}` : 'Deactivated', tone: 'neutral' };
}

export function deactivateQuestion(rows: RemovableOwner[], ids: string[]): { title: string; message: string } {
  const emails = rows.filter((r) => ids.includes(r.owner_id)).map((r) => r.email);
  return {
    title: `Deactivate ${emails.length} owner${emails.length === 1 ? '' : 's'}?`,
    message:
      `${emails.join(', ')}\n\nThey will no longer be able to sign in. This can be undone any time with Reactivate. ` +
      `They can be deleted after the waiting period.`,
  };
}

export function deleteQuestion(rows: RemovableOwner[], ids: string[]): { title: string; message: string } {
  const chosen = rows.filter((r) => ids.includes(r.owner_id));
  const tickets = chosen.reduce((sum, r) => sum + r.resolved_tickets, 0);
  const lines = [
    chosen.map((r) => r.email).join(', '),
    '',
    'This permanently deletes these sign-in accounts. It cannot be undone.',
  ];
  if (tickets > 0) lines.push(`${tickets} resolved support ticket${tickets === 1 ? '' : 's'} belonging to them will be deleted too.`);
  return { title: `Delete ${chosen.length} owner${chosen.length === 1 ? '' : 's'} permanently?`, message: lines.join('\n') };
}

export interface DeleteResult {
  deleted: { id: string; email: string | null }[];
  skipped: { id: string; email: string | null; reason: string }[];
  ticketsRemoved: number;
}

// The message shown after a delete.
export function describeDeleteResult(res: DeleteResult): string {
  const parts = [`Deleted ${res.deleted.length}.`];
  if (res.skipped.length > 0) {
    parts.push(`Skipped ${res.skipped.length}: ${res.skipped.map((s) => `${s.email ?? s.id} (${s.reason})`).join('; ')}.`);
  }
  return parts.join(' ');
}

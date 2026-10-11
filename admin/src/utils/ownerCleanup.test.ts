import {
  deactivatableIds, deactivateQuestion, deletableIds, deleteQuestion, describeDeleteResult, describeStatus, parseRemovableOwners,
  toggleOne, toggleSelectAll, RemovableOwner,
} from './ownerCleanup';

const row = (over: Partial<RemovableOwner>): RemovableOwner => ({
  owner_id: 'a', business_name: 'A', email: 'a@x.com', is_active: true, deactivated_at: null, created_at: '2026-01-01',
  open_tickets: 0, resolved_tickets: 0, can_delete: false, days_left: null, reason: 'Deactivate it first', ...over,
});

describe('parseRemovableOwners', () => {
  it('reads valid rows and drops malformed ones', () => {
    const out = parseRemovableOwners([{ owner_id: 'a', email: 'a@x.com', business_name: 'A', is_active: false, can_delete: true, days_left: 0 }, null, { owner_id: 5 }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ owner_id: 'a', is_active: false, can_delete: true, days_left: 0 });
    for (const bad of [null, undefined, {}, 'x']) expect(parseRemovableOwners(bad)).toEqual([]);
  });
});

describe('choosing who a bulk action applies to', () => {
  const rows = [
    row({ owner_id: '1', email: '1@x.com' }),
    row({ owner_id: '2', email: '2@x.com', is_active: false, can_delete: true, reason: null }),
    row({ owner_id: '3', email: '3@x.com', is_active: false, can_delete: false, days_left: 5, reason: 'Can be deleted in 5 days' }),
  ];
  const all = new Set(['1', '2', '3']);

  it('deactivates only the active ones and deletes only the eligible ones', () => {
    expect(deactivatableIds(rows, all)).toEqual(['1']);
    expect(deletableIds(rows, all)).toEqual(['2']);
  });

  it('ignores owners that are not ticked', () => {
    expect(deletableIds(rows, new Set(['3']))).toEqual([]);
    expect(deactivatableIds(rows, new Set())).toEqual([]);
  });

  it('selects all, and clears when all are already ticked', () => {
    expect(toggleSelectAll(rows, new Set())).toEqual(all);
    expect(toggleSelectAll(rows, new Set(['1']))).toEqual(all);
    expect(toggleSelectAll(rows, all)).toEqual(new Set());
    expect(toggleSelectAll([], new Set())).toEqual(new Set());
  });

  it('toggles one without changing the original', () => {
    const s = new Set(['1']);
    expect(toggleOne(s, '2')).toEqual(new Set(['1', '2']));
    expect(toggleOne(s, '1')).toEqual(new Set());
    expect(s).toEqual(new Set(['1']));
  });
});

describe('wording', () => {
  it('describes each state', () => {
    expect(describeStatus(row({}))).toEqual({ label: 'Active, no restaurant', tone: 'warn' });
    expect(describeStatus(row({ is_active: false, can_delete: true, reason: null }))).toEqual({ label: 'Deactivated, can be deleted', tone: 'good' });
    expect(describeStatus(row({ is_active: false, reason: '2 open support tickets' })).label).toBe('Deactivated. 2 open support tickets');
  });

  it('asks before deactivating and names the owners', () => {
    const q = deactivateQuestion([row({ owner_id: '1', email: '1@x.com' })], ['1']);
    expect(q.title).toBe('Deactivate 1 owner?');
    expect(q.message).toMatch(/1@x\.com/);
    expect(q.message).toMatch(/Reactivate/);
  });

  it('asks before deleting, says it is permanent, and counts resolved tickets', () => {
    const rows = [row({ owner_id: '1', email: '1@x.com', resolved_tickets: 2 }), row({ owner_id: '2', email: '2@x.com', resolved_tickets: 1 })];
    const q = deleteQuestion(rows, ['1', '2']);
    expect(q.title).toBe('Delete 2 owners permanently?');
    expect(q.message).toMatch(/cannot be undone/);
    expect(q.message).toMatch(/3 resolved support tickets/);
    expect(deleteQuestion(rows.slice(0, 1).map((r) => ({ ...r, resolved_tickets: 0 })), ['1']).message).not.toMatch(/resolved support/);
  });

  it('reports what was deleted and skipped', () => {
    expect(describeDeleteResult({ deleted: [{ id: '1', email: 'a' }], skipped: [], ticketsRemoved: 0 })).toBe('Deleted 1.');
    expect(describeDeleteResult({ deleted: [], skipped: [{ id: '2', email: 'b@x.com', reason: 'open ticket' }], ticketsRemoved: 0 }))
      .toBe('Deleted 0. Skipped 1: b@x.com (open ticket).');
  });
});

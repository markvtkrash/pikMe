// Selecting items on the admin's menu editor: every unverified item in one go (across all pages of the current search),
// and the question asked before verifying them.

export interface SelectableMenuRow {
  item_id: string;
  is_verified: boolean;
}

// The ids of the items that are not verified.
export function unverifiedIds(rows: SelectableMenuRow[]): string[] {
  return rows.filter((r) => !r.is_verified).map((r) => r.item_id);
}

// The "Select unverified" button: ticks every unverified item in `rows` (keeping what was ticked). If they are all ticked
// already, it unticks just those. Nothing else is touched.
export function toggleUnverifiedSelection(selected: Set<string>, rows: SelectableMenuRow[]): Set<string> {
  const target = unverifiedIds(rows);
  const next = new Set(selected);
  if (target.length > 0 && target.every((id) => selected.has(id))) target.forEach((id) => next.delete(id));
  else target.forEach((id) => next.add(id));
  return next;
}

// The ticked items that are still unverified: what "Verify" would change.
export function verifiableSelection(rows: SelectableMenuRow[], selected: Set<string>): string[] {
  return rows.filter((r) => !r.is_verified && selected.has(r.item_id)).map((r) => r.item_id);
}

export function verifySelectedQuestion(count: number): string {
  return `${count} item${count === 1 ? '' : 's'} will be marked as verified, and customers will see ${count === 1 ? 'it' : 'them'} as real menu items instead of AI guesses. Continue?`;
}

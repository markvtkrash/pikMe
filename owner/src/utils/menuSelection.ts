// Selecting items on the owner's Edit Menu (the Select to Delete mode): the unconfirmed ones in one go, and which of the
// selected ones can be confirmed. An "unconfirmed" item is one already saved and shown as not confirmed (isVerified false);
// a row the owner just typed (isVerified null) is confirmed automatically when the menu is saved.

export interface SelectableItem {
  isVerified: boolean | null;
  itemId: string | null;
}

// Positions (in the list) of the saved items that are not confirmed.
export function unconfirmedIndices(items: SelectableItem[]): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (it.isVerified === false && it.itemId) out.push(i);
  });
  return out;
}

// The "Select Unconfirmed" button: ticks every unconfirmed item (keeping what was already ticked). If they are all ticked
// already, it unticks just those. Nothing else is touched.
export function toggleUnconfirmedSelection(selected: Set<number>, items: SelectableItem[]): Set<number> {
  const target = unconfirmedIndices(items);
  const next = new Set(selected);
  if (target.length > 0 && target.every((i) => selected.has(i))) target.forEach((i) => next.delete(i));
  else target.forEach((i) => next.add(i));
  return next;
}

// The saved, unconfirmed items among the ticked ones: what "Confirm Selected" would confirm.
export function confirmableSelection(items: SelectableItem[], selected: Set<number>): { indices: number[]; itemIds: string[] } {
  const indices = unconfirmedIndices(items).filter((i) => selected.has(i));
  return { indices, itemIds: indices.map((i) => items[i].itemId as string) };
}

export function confirmSelectedQuestion(count: number): string {
  return `${count} item${count === 1 ? '' : 's'} will be marked as confirmed, and customers will see ${count === 1 ? 'it' : 'them'} as real menu items instead of AI guesses. Continue?`;
}

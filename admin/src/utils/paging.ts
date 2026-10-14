// Paging for the admin lists that are loaded whole and filtered on the screen (Manage Restaurants, Franchise Menu Management, Franchise Lookup).

export const LIST_PAGE_SIZE = 50;

export function pageCountFor(total: number, size: number = LIST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

// A page number kept inside what exists (the list may shrink after a search or a delete).
export function clampPage(page: number, total: number, size: number = LIST_PAGE_SIZE): number {
  return Math.min(Math.max(0, Math.floor(page) || 0), pageCountFor(total, size) - 1);
}

export function pageSlice<T>(items: T[], page: number, size: number = LIST_PAGE_SIZE): T[] {
  const p = clampPage(page, items.length, size);
  return items.slice(p * size, (p + 1) * size);
}

// "Showing 51-100 of 230": 1-based first and last row on the page (both 0 for an empty list).
export function pageRange(page: number, total: number, size: number = LIST_PAGE_SIZE): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const p = clampPage(page, total, size);
  return { from: p * size + 1, to: Math.min((p + 1) * size, total) };
}

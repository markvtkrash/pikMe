// What a customer will find on each restaurant's menu, as one word on every restaurant in the list (migration 146, menu_status_for_places).
// Pure helpers, so the rules can be tested without the database.

export type MenuStatus = 'confirmed' | 'estimated' | 'none';

const STATUSES: ReadonlySet<string> = new Set(['confirmed', 'estimated', 'none']);

export interface MenuStatusRow {
  place_id?: unknown;
  status?: unknown;
}

/** The answers from the database as place ID → status. Anything that is not a known status or has no place ID is ignored. */
export function parseMenuStatusRows(rows: unknown): Map<string, MenuStatus> {
  const out = new Map<string, MenuStatus>();
  if (!Array.isArray(rows)) return out;
  for (const row of rows as MenuStatusRow[]) {
    if (!row || typeof row.place_id !== 'string' || row.place_id === '') continue;
    if (typeof row.status !== 'string' || !STATUSES.has(row.status)) continue;
    out.set(row.place_id, row.status as MenuStatus);
  }
  return out;
}

/** The two parallel arrays the database function takes (the same position is the same restaurant). A restaurant without an ID is left out. */
export function menuStatusArgs(restaurants: { placeId?: string; name?: string }[]): { p_place_ids: string[]; p_names: string[] } {
  const ids: string[] = [];
  const names: string[] = [];
  for (const r of restaurants) {
    if (!r || typeof r.placeId !== 'string' || r.placeId === '') continue;
    ids.push(r.placeId);
    names.push(typeof r.name === 'string' ? r.name : '');
  }
  return { p_place_ids: ids, p_names: names };
}

/** Puts menuStatus on each restaurant. One the database did not answer for gets no menuStatus at all (unknown), so the app shows no badge. */
export function applyMenuStatus<T extends { placeId?: string }>(restaurants: T[], statuses: Map<string, MenuStatus>): (T & { menuStatus?: MenuStatus })[] {
  return restaurants.map((r) => {
    const status = r.placeId ? statuses.get(r.placeId) : undefined;
    return status ? { ...r, menuStatus: status } : r;
  });
}

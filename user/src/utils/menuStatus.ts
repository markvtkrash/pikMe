// What a restaurant's menu holds, as the customer sees it: a badge on the card, the order of the list, and the wording on the restaurant page.
// 'confirmed' = at least one confirmed item; 'estimated' = items, none confirmed yet (AI estimates); 'none' = no items. A restaurant from an older
// server has no status at all (unknown): no badge, and it is not pushed down the list.
export type MenuStatus = 'confirmed' | 'estimated' | 'none';

export interface MenuBadge {
  label: string;
  tone: 'confirmed' | 'estimated';
}

export const ESTIMATED_BADGE = 'Estimated menu · tap to see';

/** The badge for a card, or null when the status is unknown. */
export function menuBadge(status: MenuStatus | undefined | null): MenuBadge | null {
  if (status === 'confirmed') return { label: '✓ Menu confirmed', tone: 'confirmed' };
  // Tapping a restaurant always shows a menu (the AI estimates one when none is stored), so "no items yet" reads the same as "estimated items".
  if (status === 'estimated' || status === 'none') return { label: ESTIMATED_BADGE, tone: 'estimated' };
  return null;
}

// Lower is better. Unknown counts the same as estimated, so a list from an older server keeps its distance order.
function tier(status: MenuStatus | undefined | null): number {
  if (status === 'confirmed') return 0;
  if (status === 'none') return 2;
  return 1;
}

// A confirmed menu comes first only among restaurants about the same distance away (within half a mile, 800 m): a restaurant much closer is
// never pushed behind one that is far away just for having a confirmed menu.
export const DISTANCE_BAND_METERS = 800;

interface Sortable {
  distanceMeters: number;
  menuStatus?: MenuStatus | null;
}

/** A new list ordered by distance band, then menu status, then exact distance. The input is not changed. */
export function sortByDistanceAndMenu<T extends Sortable>(restaurants: T[]): T[] {
  const band = (r: Sortable) => Math.floor((r.distanceMeters || 0) / DISTANCE_BAND_METERS);
  return restaurants
    .map((r, i) => ({ r, i }))
    .sort((a, b) =>
      band(a.r) - band(b.r) ||
      tier(a.r.menuStatus) - tier(b.r.menuStatus) ||
      (a.r.distanceMeters || 0) - (b.r.distanceMeters || 0) ||
      a.i - b.i
    )
    .map((x) => x.r);
}

/** Estimated items get no nutrition numbers: only an item the restaurant has confirmed shows them. */
export function showNutritionFor(item: { isVerified?: boolean | null }): boolean {
  return item.isVerified === true;
}

// The short line at the top of the menu page; tapping it opens MENU_SOON_NOTE.
export const MENU_SOON_LINE = 'Estimated menu · not confirmed yet';

export const MENU_SOON_NOTE =
  'Menu coming soon. These are estimated items until the restaurant confirms its menu. A dish may not be offered, and details may be wrong.';

/** The line at the top of the menu while no item is confirmed yet, or null (nothing to show, or at least one item is confirmed). */
export function menuComingSoonNote(items: { isVerified?: boolean | null }[]): string | null {
  if (items.length === 0) return null;
  return items.some((i) => i.isVerified === true) ? null : MENU_SOON_NOTE;
}

export const MENU_EMPTY_TITLE = 'Menu coming soon';
export const MENU_EMPTY_BODY = "We don't have this menu yet. Check with the restaurant for what they serve.";

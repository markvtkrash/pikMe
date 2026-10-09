// Which menu_items rows belong to a restaurant, the same way customers see them (get_menu_items_for_restaurant, migration 103):
//   an independent restaurant has ONLY the items tied to its own place; with none it has an empty menu, never another list;
//   a franchise shares one chain menu stored by name (rows with no place).
// Used by every owner screen that lists the menu, so Edit Menu, Add Coupon, Coupon Status and the rest always agree.

export interface MenuRowLike {
  place_id?: string | null;
}

// `isChain` is true / false when known, undefined when it could not be found out (then the older behaviour applies: the
// shared rows are the fallback, so a franchise never loses its menu to a failed lookup).
export function chooseMenuRows<T extends MenuRowLike>(rows: T[], placeId: string | null | undefined, isChain: boolean | undefined): T[] {
  const shared = rows.filter((row) => row.place_id == null);
  if (!placeId) return shared;
  const own = rows.filter((row) => row.place_id === placeId);
  if (own.length > 0) return own;
  return isChain === false ? [] : shared;
}

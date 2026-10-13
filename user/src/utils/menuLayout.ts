// Helpers for the menu list's two layouts: the compact list (one card per row) and the grid (two tiles per row, each showing just the name with a
// dropdown for the details).

export type MenuLayout = 'list' | 'grid';

// A saved choice read back from storage; anything unexpected is treated as "no choice yet".
export function normalizeLayout(value: unknown): MenuLayout | null {
  return value === 'list' || value === 'grid' ? value : null;
}

// The person's saved choice, else the list ("Detailed") on every screen size.
export function resolveLayout(saved: MenuLayout | null): MenuLayout {
  return saved ?? 'list';
}

export interface Spacer {
  _spacer: true;
}

// A grid row needs a partner for the last tile when the count is odd, or that tile would stretch across the full width.
export function withGridSpacer<T>(items: T[], columns: number = 2): (T | Spacer)[] {
  if (columns < 2 || items.length % columns === 0) return items;
  const missing = columns - (items.length % columns);
  return [...items, ...Array.from({ length: missing }, () => ({ _spacer: true as const }))];
}

export interface TileIcon {
  icon: string;
  label: string;   // spoken by screen readers
}

// The tiny icons on a collapsed tile, so the status is visible without opening the details. None of them says a dish is free of anything. Most important first.
export function tileIcons(flags: { warnings: boolean; noticeTag: string | null; fit: boolean; coupons: number }): TileIcon[] {
  const out: TileIcon[] = [];
  if (flags.warnings) out.push({ icon: '🚫', label: 'Has a dietary warning' });
  if (flags.noticeTag) {
    out.push(flags.noticeTag.startsWith('🤖')
      ? { icon: '🤖', label: 'AI-estimated item' }
      : { icon: '⚠', label: 'Unconfirmed item' });
  }
  if (flags.fit) out.push({ icon: '👍', label: 'Calories and macros may fit your goals' });
  if (flags.coupons > 0) out.push({ icon: '⭐', label: flags.coupons === 1 ? 'Has a coupon' : `Has ${flags.coupons} coupons` });
  return out;
}

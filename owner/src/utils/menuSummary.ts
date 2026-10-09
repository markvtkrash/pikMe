// The numbers and wording for the summary card at the top of the owner's Menu Management page.

// Percent of the menu that is confirmed (verified), 0 to 100. An empty menu is 0.
export function confirmedPercent(total: number, verified: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const v = Math.min(Math.max(Number.isFinite(verified) ? verified : 0, 0), total);
  return Math.round((v / total) * 100);
}

export interface MenuSummaryText {
  count: string;                 // "31 menu items"
  line: string;                  // "27 confirmed · 4 need confirming" or "All confirmed"
  tone: 'good' | 'warn' | 'empty';
}

export function menuSummaryText(total: number, verified: number, isChain: boolean): MenuSummaryText {
  if (total <= 0) {
    return {
      count: 'No menu items yet',
      line: isChain ? 'The chain menu has no items yet.' : 'Your menu is empty. Pick a way to add it below.',
      tone: 'empty',
    };
  }
  const count = `${total} menu item${total === 1 ? '' : 's'}`;
  const toConfirm = total - Math.min(Math.max(verified, 0), total);
  if (toConfirm === 0) return { count, line: '✓ All confirmed', tone: 'good' };
  const confirmed = total - toConfirm;
  return { count, line: `${confirmed} confirmed · ${toConfirm} need confirming`, tone: 'warn' };
}

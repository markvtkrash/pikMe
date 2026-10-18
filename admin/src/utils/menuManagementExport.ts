// Builds the printable HTML for "Export PDF" on Menu Management (via expo-print's printAsync,
// which opens the OS/browser print sheet -- the admin picks "Save as PDF" there, same on native
// and web). Takes the full FILTERED list, not just the current page -- that's the whole point of
// exporting: every row the current search/filters match, not just the 50 shown on screen.

import type { RestaurantMenuSummary } from '../api/menuAdmin';

const SOURCE_LABEL: Record<string, string> = { claimed: 'Claimed', cached: 'Cached', city: 'City import' };

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function statusOrOwner(r: RestaurantMenuSummary): string {
  if (r.source === 'claimed') {
    const owner = r.owner_business_name ? esc(r.owner_business_name) : 'Unknown owner';
    return `${owner}${r.status ? ` (${esc(r.status)})` : ''}`;
  }
  if (r.location_count > 1) return `${r.location_count} cached locations`;
  if (r.shares_menu_with_claimed) return 'Shares menu with a claimed location';
  return '';
}

function itemCounts(r: RestaurantMenuSummary): string {
  return r.total_items === 0 ? 'No items' : `${r.total_items} total, ${r.verified_items} verified, ${r.unverified_items} unverified`;
}

/** The full HTML document passed to Print.printAsync. Empty-safe (prints a "no rows" line rather than a broken table). */
export function buildMenuManagementExportHtml(rows: RestaurantMenuSummary[], generatedAt: Date = new Date()): string {
  const body = rows.length === 0
    ? '<tr><td colspan="5" class="empty">No restaurants match the current filters.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td>${esc(r.restaurant_name)}</td>
        <td>${SOURCE_LABEL[r.source] ?? esc(r.source)}</td>
        <td>${statusOrOwner(r)}</td>
        <td>${esc(r.address)}${r.city || r.state ? `<br/><span class="muted">${esc([r.city, r.state].filter(Boolean).join(', '))}</span>` : ''}</td>
        <td>${itemCounts(r)}</td>
      </tr>`).join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #222; padding: 24px; }
  h1 { font-size: 18px; margin-bottom: 2px; }
  .meta { font-size: 11px; color: #888; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; background: #f0f0f0; padding: 6px 8px; border-bottom: 2px solid #ccc; }
  td { padding: 6px 8px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
  .muted { color: #888; }
  .empty { text-align: center; color: #888; padding: 24px; }
  tr { page-break-inside: avoid; }
</style>
</head>
<body>
  <h1>Menu Management</h1>
  <div class="meta">${rows.length} restaurant${rows.length === 1 ? '' : 's'} &middot; exported ${esc(generatedAt.toLocaleString())}</div>
  <table>
    <thead>
      <tr><th>Name</th><th>Source</th><th>Status / Owner</th><th>Address</th><th>Menu items</th></tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}

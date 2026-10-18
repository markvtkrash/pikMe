import { buildMenuManagementExportHtml } from './menuManagementExport';
import type { RestaurantMenuSummary } from '../api/menuAdmin';

function row(overrides: Partial<RestaurantMenuSummary> = {}): RestaurantMenuSummary {
  return {
    restaurant_name: 'Magic Noodle',
    address: '123 Main St',
    source: 'claimed',
    restaurant_id: 'r1',
    status: 'approved',
    owner_business_name: 'Noodle LLC',
    owner_email: 'owner@example.com',
    location_count: 1,
    shares_menu_with_claimed: false,
    total_items: 10,
    verified_items: 6,
    unverified_items: 4,
    place_id: 'p1',
    is_franchise: false,
    city: 'Austin',
    state: 'TX',
    ...overrides,
  };
}

describe('buildMenuManagementExportHtml', () => {
  it('includes the row count and each restaurant name', () => {
    const html = buildMenuManagementExportHtml([row(), row({ restaurant_name: 'Second Place' })]);
    expect(html).toContain('2 restaurants');
    expect(html).toContain('Magic Noodle');
    expect(html).toContain('Second Place');
  });

  it('singular count for exactly one row', () => {
    const html = buildMenuManagementExportHtml([row()]);
    expect(html).toContain('1 restaurant &middot;');
    expect(html).not.toContain('1 restaurants');
  });

  it('shows a friendly empty state instead of a broken table', () => {
    const html = buildMenuManagementExportHtml([]);
    expect(html).toContain('No restaurants match the current filters.');
    expect(html).toContain('0 restaurants');
  });

  it('escapes HTML in a restaurant name so a stray "<" or "&" cannot break the table', () => {
    const html = buildMenuManagementExportHtml([row({ restaurant_name: 'Mac & Cheese <Co>' })]);
    expect(html).toContain('Mac &amp; Cheese &lt;Co&gt;');
    expect(html).not.toContain('Mac & Cheese <Co>');
  });

  it('shows owner and status for a claimed restaurant', () => {
    const html = buildMenuManagementExportHtml([row({ source: 'claimed', owner_business_name: 'Noodle LLC', status: 'approved' })]);
    expect(html).toContain('Noodle LLC (approved)');
  });

  it('shows an unknown-owner fallback when a claimed restaurant has no owner business name', () => {
    const html = buildMenuManagementExportHtml([row({ source: 'claimed', owner_business_name: null })]);
    expect(html).toContain('Unknown owner');
  });

  it('shows the cached-location count for an unclaimed franchise-grouped row', () => {
    const html = buildMenuManagementExportHtml([row({ source: 'cached', owner_business_name: null, location_count: 4 })]);
    expect(html).toContain('4 cached locations');
  });

  it('notes a shared menu for an unclaimed location with no owner', () => {
    const html = buildMenuManagementExportHtml([
      row({ source: 'cached', owner_business_name: null, location_count: 1, shares_menu_with_claimed: true }),
    ]);
    expect(html).toContain('Shares menu with a claimed location');
  });

  it('reports item counts, or "No items" when there are none', () => {
    const withItems = buildMenuManagementExportHtml([row({ total_items: 10, verified_items: 6, unverified_items: 4 })]);
    expect(withItems).toContain('10 total, 6 verified, 4 unverified');

    const noItems = buildMenuManagementExportHtml([row({ total_items: 0, verified_items: 0, unverified_items: 0 })]);
    expect(noItems).toContain('No items');
  });

  it('includes city and state under the address when present, and omits the line when absent', () => {
    const withLocation = buildMenuManagementExportHtml([row({ city: 'Austin', state: 'TX' })]);
    expect(withLocation).toContain('Austin, TX');

    const withoutLocation = buildMenuManagementExportHtml([row({ city: null, state: null })]);
    expect(withoutLocation).not.toContain('<span class="muted">');
  });
});

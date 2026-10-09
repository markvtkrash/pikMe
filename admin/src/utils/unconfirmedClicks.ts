// Restaurants customers opened that have no confirmed menu item (migrations 119 and 125): row shape and wording for the admin list.

export interface UnconfirmedClickedRestaurant {
  place_id: string;
  restaurant_name: string;
  address: string | null;
  city: string | null;
  click_count: number;
  last_clicked_at: string;
  claimed: boolean;
  crawl_state: string | null;
  crawl_detail: string | null;
}

export interface UnconfirmedClickedPage {
  total: number;
  rows: UnconfirmedClickedRestaurant[];
}

export const UNCONFIRMED_PAGE_SIZE = 25;

// Turns the database rows into a page: the total comes with every row (0 when the page is empty).
export function toUnconfirmedPage(data: any[] | null | undefined): UnconfirmedClickedPage {
  const rows = (data ?? []).map((r) => ({
    place_id: String(r.place_id),
    restaurant_name: String(r.restaurant_name ?? ''),
    address: r.address ?? null,
    city: r.city ?? null,
    click_count: Number(r.click_count ?? 0),
    last_clicked_at: String(r.last_clicked_at ?? ''),
    claimed: r.claimed === true,
    crawl_state: r.crawl_state ?? null,
    crawl_detail: r.crawl_detail ?? null,
  }));
  const total = rows.length > 0 ? Number((data as any[])[0].total_count ?? rows.length) : 0;
  return { total, rows };
}

// What the crawler did about a restaurant, in words. `quiet` ones need nothing from the admin soon. A restaurant with no
// crawler record has no menu link yet (nothing looks one up any more): the admin adds one, or uploads the menu.
export function describeCrawlState(state: string | null | undefined): { label: string; quiet: boolean } {
  switch (state) {
    case 'pending':
    case 'crawling':
      return { label: 'Crawler will read its menu link', quiet: true };
    case 'done':
      return { label: 'Menu link read, no confirmed dishes yet', quiet: false };
    case 'no_items':
      return { label: 'Menu link read, no dishes found', quiet: false };
    case 'error':
      return { label: 'Crawler failed, will retry', quiet: true };
    case 'needs_attention':
      return { label: 'Crawler could not read it', quiet: false };
    default:
      return { label: 'No menu link yet: add one or upload the menu', quiet: false };
  }
}

// "Mar 4" style date for the last click; blank when the value is not a date.
export function formatClickDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function describeClickCount(n: number): string {
  return `${n} ${n === 1 ? 'click' : 'clicks'}`;
}

export function describeTotal(total: number): string {
  if (total === 0) return 'No restaurants were opened without a confirmed menu item.';
  return `${total} ${total === 1 ? 'restaurant was' : 'restaurants were'} opened without a confirmed menu item.`;
}

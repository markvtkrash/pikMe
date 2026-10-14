// Helpers for the admin Region Management page (migration 142): reading the server's list, wording, filters, and the go-live time typed by an admin.

export type RegionStatus = 'off' | 'scheduled' | 'live';
export type RegionFilter = 'all' | 'live' | 'scheduled' | 'off';

export interface Region {
  stateCode: string;
  name: string;
  status: RegionStatus;
  goLiveAt: string | null;
  note: string | null;
  isOpen: boolean;
  waitlistCount: number;
  restaurantCount: number;
  withMenuCount: number;
  updatedAt: string | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// admin_list_regions rows, as the server sends them.
export function parseRegions(raw: unknown): Region[] {
  if (!Array.isArray(raw)) return [];
  const out: Region[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r.state_code !== 'string' || typeof r.name !== 'string') continue;
    const status: RegionStatus = r.status === 'live' || r.status === 'scheduled' ? r.status : 'off';
    out.push({
      stateCode: r.state_code,
      name: r.name,
      status,
      goLiveAt: typeof r.go_live_at === 'string' ? r.go_live_at : null,
      note: typeof r.note === 'string' && r.note.trim() ? r.note : null,
      isOpen: r.is_open === true,
      waitlistCount: num(r.waitlist_count),
      restaurantCount: num(r.restaurant_count),
      withMenuCount: num(r.with_menu_count),
      updatedAt: typeof r.updated_at === 'string' ? r.updated_at : null,
    });
  }
  return out;
}

// What the badge says. A scheduled state whose time has passed is already open.
export function statusLabel(r: Pick<Region, 'status' | 'isOpen'>): string {
  if (r.isOpen) return 'Live';
  return r.status === 'scheduled' ? 'Scheduled' : 'Off';
}

export function matchesFilter(r: Pick<Region, 'status' | 'isOpen'>, filter: RegionFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'live') return r.isOpen;
  if (filter === 'scheduled') return !r.isOpen && r.status === 'scheduled';
  return !r.isOpen && r.status === 'off';
}

export function filterRegions(regions: Region[], filter: RegionFilter, search: string): Region[] {
  const q = search.trim().toLowerCase();
  return regions.filter((r) => matchesFilter(r, filter) && (!q || r.name.toLowerCase().includes(q) || r.stateCode.toLowerCase() === q));
}

export function regionCounts(regions: Region[]): { all: number; live: number; scheduled: number; off: number; waitlist: number } {
  return {
    all: regions.length,
    live: regions.filter((r) => matchesFilter(r, 'live')).length,
    scheduled: regions.filter((r) => matchesFilter(r, 'scheduled')).length,
    off: regions.filter((r) => matchesFilter(r, 'off')).length,
    waitlist: regions.reduce((sum, r) => sum + r.waitlistCount, 0),
  };
}

// A warning shown before a state is opened, so a thin state is noticed. Null when it looks ready.
export function readinessWarning(r: Pick<Region, 'restaurantCount' | 'withMenuCount'>): string | null {
  if (r.restaurantCount === 0) return 'No restaurants found here yet.';
  if (r.restaurantCount < 20) return `Only ${r.restaurantCount} restaurant${r.restaurantCount === 1 ? '' : 's'} found here.`;
  const share = r.withMenuCount / r.restaurantCount;
  if (share < 0.5) return `Only ${r.withMenuCount} of ${r.restaurantCount} restaurants have a menu.`;
  return null;
}

// "2026-11-01 09:00" (the admin's own time) to an exact moment. Null when it is not a real date and time.
export function parseGoLive(text: string): string | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})\s*$/.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== mi) return null;
  return date.toISOString();
}

// The reverse, for the text box: an exact moment as "2026-11-01 09:00" in the admin's own time.
export function goLiveInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function describeGoLive(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// The master switch (migration 142): kept on its own card, changed only after the key is typed.
export const REGION_SWITCH_KEY = 'enforceRegionGating';
export const TURN_OFF_ALL_PHRASE = 'turn off all regions';

export function regionSwitchText(value: string | undefined): { on: boolean; state: string; button: string; title: string; message: string } {
  const on = value === 'true';
  return on
    ? {
        on,
        state: 'ON: customers can use the app only in states that are Live.',
        button: 'Turn OFF',
        title: 'Turn OFF region gating?',
        message: 'Customers will be let in everywhere again, in every state, whatever the table below says. The apps pick the change up within a few minutes.',
      }
    : {
        on,
        state: 'OFF: customers are let in everywhere, whatever the table below says.',
        button: 'Turn ON',
        title: 'Turn ON region gating?',
        message: 'Customers in a state that is not Live (and anyone outside the US) will see "Coming soon" instead of restaurants. Staff accounts are never blocked. The apps pick the change up within a few minutes.',
      };
}

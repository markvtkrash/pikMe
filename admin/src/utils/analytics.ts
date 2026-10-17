// The customer app's usage numbers (migration 147, admin_analytics_summary): parsing the answer and working out the funnel. Pure, so it can be tested.

export interface EventCount {
  event: string;
  events: number;
  installs: number;
}

export interface AnalyticsSummary {
  days: number;
  installs: number;        // distinct installs seen in the period
  newInstalls: number;     // installs whose first event is in the period
  events: EventCount[];
  daily: { day: string; installs: number }[];
  retention: { cohort: number; returned: number };
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** The server's answer as numbers we can trust; anything missing or odd becomes zero or an empty list. */
export function parseSummary(raw: unknown): AnalyticsSummary {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const events: EventCount[] = Array.isArray(r.events)
    ? r.events.filter((e: any) => e && typeof e.event === 'string').map((e: any) => ({ event: e.event, events: num(e.events), installs: num(e.installs) }))
    : [];
  const daily = Array.isArray(r.daily)
    ? r.daily.filter((d: any) => d && typeof d.day === 'string').map((d: any) => ({ day: d.day, installs: num(d.installs) }))
    : [];
  return {
    days: num(r.days) || 30,
    installs: num(r.installs),
    newInstalls: num(r.new_installs),
    events,
    daily,
    retention: { cohort: num(r.retention?.cohort), returned: num(r.retention?.returned) },
  };
}

export const EVENT_LABELS: Record<string, string> = {
  app_open: 'Opened the app',
  search: 'Searched',
  restaurant_view: 'Opened a restaurant',
  menu_view: 'Saw a menu',
  save: 'Saved a restaurant',
  sign_up: 'Signed up',
  coupon_view: 'Looked at a coupon',
  share: 'Shared',
};

export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event;
}

// The steps of the funnel, in order. An install is counted at a step if it sent that event in the period (not necessarily in this order).
export const FUNNEL_STEPS = ['app_open', 'restaurant_view', 'menu_view', 'save', 'sign_up'] as const;

export interface FunnelRow {
  event: string;
  label: string;
  installs: number;
  /** share of the first step, 0 to 100, or null when nobody opened the app */
  ofFirst: number | null;
  /** share of the step before, 0 to 100, or null for the first step or when the step before is zero */
  ofPrevious: number | null;
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : null);

export function buildFunnel(summary: AnalyticsSummary): FunnelRow[] {
  const byEvent = new Map(summary.events.map((e) => [e.event, e.installs]));
  const first = byEvent.get(FUNNEL_STEPS[0]) ?? 0;
  return FUNNEL_STEPS.map((event, i) => {
    const installs = byEvent.get(event) ?? 0;
    const previous = i === 0 ? null : byEvent.get(FUNNEL_STEPS[i - 1]) ?? 0;
    return {
      event,
      label: eventLabel(event),
      installs,
      ofFirst: pct(installs, first),
      ofPrevious: previous === null ? null : pct(installs, previous),
    };
  });
}

/** Of the installs old enough to tell, the share that came back a week or more after their first visit; null when none is old enough yet. */
export function weekLaterReturn(summary: AnalyticsSummary): number | null {
  return pct(summary.retention.returned, summary.retention.cohort);
}

export function formatPercent(value: number | null): string {
  return value === null ? '–' : `${value}%`;
}

/** The busiest day's count, at least 1, so a bar can be drawn as a share of it without dividing by zero. */
export function maxDaily(summary: AnalyticsSummary): number {
  return Math.max(1, ...summary.daily.map((d) => d.installs));
}

export const PERIOD_CHOICES = [7, 30, 90] as const;

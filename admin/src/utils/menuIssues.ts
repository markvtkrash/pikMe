// Helpers for the "Independent restaurant menu issues" report (migration 107).
export interface PlaceMenuIssue {
  job_id: number;
  place_id: string;
  restaurant_name: string;
  address: string | null;
  city: string | null;
  // needs_attention (stopped retrying) or a failure that will be retried: no_menu_link, unreadable, error
  status: string;
  attempts: number;
  last_detail: string | null;
  // how many times customers opened it while it had no menu
  requested_count: number;
  finished_at: string | null;
  next_attempt_at: string | null;
  override_link: string | null;
  claimed: boolean;
}

export type IssueTone = 'bad' | 'warn';

export function placeIssueInfo(status: string): { label: string; tone: IssueTone; stopped: boolean } {
  switch (status) {
    case 'needs_attention': return { label: 'Needs attention', tone: 'bad', stopped: true };
    case 'no_menu_link': return { label: 'No menu link', tone: 'warn', stopped: false };
    case 'unreadable': return { label: 'Page not readable', tone: 'warn', stopped: false };
    case 'error': return { label: 'Error', tone: 'warn', stopped: false };
    default: return { label: status, tone: 'warn', stopped: false };
  }
}

// "retries in 5 h" / "retries in 2 d" / "retries soon"; nothing for a stopped job.
export function describeRetry(issue: Pick<PlaceMenuIssue, 'status' | 'next_attempt_at'>, now: Date = new Date()): string {
  if (placeIssueInfo(issue.status).stopped || !issue.next_attempt_at) return '';
  const at = new Date(issue.next_attempt_at).getTime();
  if (!Number.isFinite(at)) return '';
  const mins = Math.round((at - now.getTime()) / 60_000);
  if (mins <= 30) return 'retries soon';
  if (mins < 60 * 24) return `retries in ${Math.max(1, Math.round(mins / 60))} h`;
  return `retries in ${Math.round(mins / (60 * 24))} d`;
}

export function summarizePlaceIssues(rows: Pick<PlaceMenuIssue, 'status'>[]): { total: number; stopped: number; retrying: number } {
  const stopped = rows.filter((r) => placeIssueInfo(r.status).stopped).length;
  return { total: rows.length, stopped, retrying: rows.length - stopped };
}

export function describeRequests(count: number): string {
  if (count <= 1) return 'Opened by a customer once';
  return `Opened by customers ${count} times`;
}

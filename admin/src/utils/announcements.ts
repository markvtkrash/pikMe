// The admin page for in-app announcements (Tools -> Announcements, migration 128): turning the form into what the server
// takes (with the same checks, so a mistake is caught before sending), and the wording for the list.

export type AnnouncementAudience = 'customer' | 'owner' | 'both';
export type AnnouncementKind = 'info' | 'important';
export type AnnouncementStatus = 'scheduled' | 'live' | 'ended';

export interface AnnouncementRow {
  id: string;
  audience: AnnouncementAudience;
  title: string;
  message: string;
  kind: AnnouncementKind;
  link_label: string | null;
  link_url: string | null;
  starts_at: string;
  ends_at: string | null;
  min_app_version: string | null;
  max_app_version: string | null;
  status: AnnouncementStatus;
  created_at: string;
}

export interface AnnouncementForm {
  audience: AnnouncementAudience | '';
  title: string;
  message: string;
  kind: AnnouncementKind;
  linkLabel: string;
  linkUrl: string;
  // blank = now / never ends. Otherwise local time as YYYY-MM-DD HH:MM
  startsAt: string;
  endsAt: string;
  minAppVersion: string;
  maxAppVersion: string;
}

export interface AnnouncementInput {
  audience: AnnouncementAudience;
  title: string;
  message: string;
  kind: AnnouncementKind;
  linkLabel: string | null;
  linkUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  minAppVersion: string | null;
  maxAppVersion: string | null;
}

export const EMPTY_ANNOUNCEMENT_FORM: AnnouncementForm = {
  audience: '', title: '', message: '', kind: 'info', linkLabel: '', linkUrl: '',
  startsAt: '', endsAt: '', minAppVersion: '', maxAppVersion: '',
};

export const TITLE_MAX = 80;
export const MESSAGE_MAX = 600;
export const LINK_LABEL_MAX = 40;

const VERSION_RE = /^[0-9]+(\.[0-9]+){0,2}$/;

// "2026-10-12 09:30" (local time) -> an ISO time; blank -> null (not set); anything else -> undefined (not a valid time).
export function parseLocalDateTime(text: string): string | null | undefined {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(t);
  if (!m) return undefined;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  // reject dates that roll over (for example 2026-02-31)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59) return undefined;
  return date.toISOString();
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Checks the form the way the server will, and returns what to send, or the first problem in plain words.
export function buildAnnouncementInput(form: AnnouncementForm): { ok: true; value: AnnouncementInput } | { ok: false; error: string } {
  if (!form.audience) return { ok: false, error: 'Choose who the announcement is for.' };
  const title = form.title.trim();
  const message = form.message.trim();
  if (!title) return { ok: false, error: 'Write a title.' };
  if (title.length > TITLE_MAX) return { ok: false, error: `The title can be at most ${TITLE_MAX} characters.` };
  if (!message) return { ok: false, error: 'Write the message.' };
  if (message.length > MESSAGE_MAX) return { ok: false, error: `The message can be at most ${MESSAGE_MAX} characters.` };

  const label = form.linkLabel.trim();
  const url = form.linkUrl.trim();
  if ((label === '') !== (url === '')) return { ok: false, error: 'A link needs both a button label and a web address.' };
  if (label.length > LINK_LABEL_MAX) return { ok: false, error: `The link button label can be at most ${LINK_LABEL_MAX} characters.` };
  if (url && !/^https:\/\/[^\s]{4,2000}$/i.test(url)) return { ok: false, error: 'The link must be a full web address starting with https://' };

  const startsAt = parseLocalDateTime(form.startsAt);
  const endsAt = parseLocalDateTime(form.endsAt);
  if (startsAt === undefined) return { ok: false, error: 'The start must look like 2026-10-12 09:30, or be left blank to start now.' };
  if (endsAt === undefined) return { ok: false, error: 'The end must look like 2026-10-19 18:00, or be left blank to never end.' };
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt ?? new Date().toISOString())) return { ok: false, error: 'The end must be after the start.' };

  const min = form.minAppVersion.trim();
  const max = form.maxAppVersion.trim();
  if (min && !VERSION_RE.test(min)) return { ok: false, error: 'The lowest app version must look like 1.2.0.' };
  if (max && !VERSION_RE.test(max)) return { ok: false, error: 'The highest app version must look like 1.2.0.' };
  if (min && max && compareVersions(min, max) > 0) return { ok: false, error: 'The lowest app version cannot be higher than the highest.' };
  if ((min || max) && form.audience === 'owner') return { ok: false, error: 'App versions only apply to customers; clear them for an owner announcement.' };

  return {
    ok: true,
    value: {
      audience: form.audience, title, message, kind: form.kind,
      linkLabel: label || null, linkUrl: url || null, startsAt, endsAt,
      minAppVersion: min || null, maxAppVersion: max || null,
    },
  };
}

// The form for editing an existing row.
export function formFromRow(row: AnnouncementRow): AnnouncementForm {
  const local = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  return {
    audience: row.audience, title: row.title, message: row.message, kind: row.kind,
    linkLabel: row.link_label ?? '', linkUrl: row.link_url ?? '',
    startsAt: local(row.starts_at), endsAt: local(row.ends_at),
    minAppVersion: row.min_app_version ?? '', maxAppVersion: row.max_app_version ?? '',
  };
}

export function describeAudience(audience: string): string {
  switch (audience) {
    case 'customer': return 'Customers';
    case 'owner': return 'Owners';
    case 'both': return 'Customers and owners';
    default: return audience;
  }
}

export function describeStatus(status: string): { label: string; tone: 'good' | 'warn' | 'neutral' } {
  switch (status) {
    case 'live': return { label: 'Live', tone: 'good' };
    case 'scheduled': return { label: 'Scheduled', tone: 'warn' };
    default: return { label: 'Ended', tone: 'neutral' };
  }
}

// "Oct 12, 9:30 AM" style time for the list; blank for a missing or bad time.
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function describeWindow(row: Pick<AnnouncementRow, 'starts_at' | 'ends_at' | 'status'>): string {
  const from = formatWhen(row.starts_at);
  const to = formatWhen(row.ends_at);
  if (row.status === 'scheduled') return to ? `Starts ${from}, ends ${to}` : `Starts ${from}`;
  return to ? `${from} to ${to}` : `Since ${from}`;
}

export function describeVersions(row: Pick<AnnouncementRow, 'min_app_version' | 'max_app_version'>): string {
  const { min_app_version: min, max_app_version: max } = row;
  if (min && max) return `App versions ${min} to ${max}`;
  if (min) return `App versions ${min} and newer`;
  if (max) return `App versions up to ${max}`;
  return '';
}

// Wording for the "send" button's confirmation.
export function publishQuestion(input: Pick<AnnouncementInput, 'audience' | 'startsAt'>): string {
  const who = describeAudience(input.audience).toLowerCase();
  const when = input.startsAt && Date.parse(input.startsAt) > Date.now() ? 'It will go live at the time you set.' : 'It goes live right away.';
  return `Publish this announcement to ${who}? ${when} People see it once, the next time they open the app.`;
}

// In-app announcements an admin publishes (migration 128): reading what the server sends, choosing which one to show next,
// and the link rules. Everything is defensive: a malformed announcement is dropped, never a crash.

export interface Announcement {
  id: string;
  title: string;
  message: string;
  // 'important' must be acknowledged (it cannot be dismissed by tapping outside it)
  kind: 'info' | 'important';
  linkLabel: string | null;
  linkUrl: string | null;
}

// Only a web address starting with https:// can be opened from an announcement.
export function safeLinkUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  return /^https:\/\/[^\s]{4,2000}$/i.test(u) ? u : null;
}

// The announcements in the config the server returned: valid ones only, at most 3, important first.
export function parseAnnouncements(raw: unknown): Announcement[] {
  if (!Array.isArray(raw)) return [];
  const out: Announcement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const message = typeof r.message === 'string' ? r.message.trim() : '';
    if (!id || !title || !message) continue;
    const url = safeLinkUrl(r.link_url);
    const label = typeof r.link_label === 'string' ? r.link_label.trim() : '';
    out.push({
      id,
      title: title.slice(0, 80),
      message: message.slice(0, 600),
      kind: r.kind === 'important' ? 'important' : 'info',
      linkLabel: url && label ? label.slice(0, 40) : null,
      linkUrl: url && label ? url : null,
    });
  }
  return out.sort((a, b) => Number(b.kind === 'important') - Number(a.kind === 'important')).slice(0, 3);
}

// The first announcement this device has not shown yet, or null.
export function nextAnnouncement(list: Announcement[], seenIds: string[]): Announcement | null {
  const seen = new Set(seenIds);
  return list.find((a) => !seen.has(a.id)) ?? null;
}

// Remembers an id as seen, keeping the list from growing without limit (the newest 200 are kept).
export function addSeenId(seenIds: string[], id: string): string[] {
  if (seenIds.includes(id)) return seenIds;
  return [...seenIds, id].slice(-200);
}

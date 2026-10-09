// The menu link box on an admin's Manage page for one restaurant (migration 121): wording and input checks.

export interface PlaceMenuLink {
  link: string;
  source: 'owner' | 'admin' | 'google' | string;
  status: string | null;
  detail: string | null;
  finished_at: string | null;
  // when the link in force was saved
  requested_at: string | null;
  // the admin's stored link and whether it worked when last read (null: not read yet); shown even when the owner's link is in force
  admin_link: string | null;
  admin_link_ok: boolean | null;
}

// Turns what the database returned (zero or one row) into the current link, or null when there is none.
export function toPlaceMenuLink(data: any[] | null | undefined): PlaceMenuLink | null {
  const row = data && data[0];
  if (!row || typeof row.link !== 'string' || !row.link.trim()) return null;
  return {
    link: row.link,
    source: row.source ?? 'owner',
    status: row.status ?? null,
    detail: row.detail ?? null,
    finished_at: row.finished_at ?? null,
    requested_at: row.requested_at ?? null,
    admin_link: typeof row.admin_link === 'string' && row.admin_link.trim() ? row.admin_link : null,
    admin_link_ok: typeof row.admin_link_ok === 'boolean' ? row.admin_link_ok : null,
  };
}

// How the admin's own link did the last time it was read.
export function describeAdminLinkResult(ok: boolean | null | undefined): string {
  if (ok === true) return 'worked: dishes were added';
  if (ok === false) return "didn't work: no dishes found";
  return 'not read yet';
}

// True when the owner's link is the one in force but the admin has a different link stored: the admin's link is on hold.
export function adminLinkOnHold(link: Pick<PlaceMenuLink, 'source' | 'link' | 'admin_link'>): boolean {
  return link.source === 'owner' && !!link.admin_link && link.admin_link !== link.link;
}

export function describeLinkSource(source: string | null | undefined): string {
  switch (source) {
    case 'admin': return 'set by an admin';
    case 'owner': return "the owner's link";
    case 'google': return 'found online by Google lookup';
    default: return 'unknown source';
  }
}

// What the last read of the link did, in words (blank when it has not been read yet).
export function describeLinkStatus(status: string | null | undefined): string {
  switch (status) {
    case 'pending': return 'Waiting to be read at the next crawler run';
    case 'crawling': return 'Being read now';
    case 'done': return 'Read: dishes were added';
    case 'no_items': return 'Read, but no dishes were found';
    case 'error': return 'Could not be read, will retry';
    case 'needs_attention': return 'Could not be read after several tries';
    default: return '';
  }
}

// A trimmed link when it is a usable web address, '' for a blank (meaning: remove the admin link), or null if invalid.
export function checkMenuLinkInput(raw: string): string | null {
  const v = String(raw ?? '').trim();
  if (v === '') return '';
  if (v.length > 2000 || /\s/.test(v)) return null;
  return /^https?:\/\/[^/?#\s]+\.[^/?#\s]+/i.test(v) ? v : null;
}

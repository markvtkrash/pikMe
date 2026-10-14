// Region launch control, seen from the customer app (migration 142): the server says whether the state the customer is standing in is open. Anything
// unexpected counts as "open", so a hiccup never shows a "Coming soon" screen by mistake.

export interface RegionAccess {
  enforced: boolean;
  allowed: boolean;
  // live | scheduled | off | not_us | unknown | unknown_location
  status: string;
  stateCode: string | null;
  name: string | null;
  goLiveAt: string | null;
  countryCode: string | null;
}

export const REGION_OPEN: RegionAccess = { enforced: false, allowed: true, status: 'live', stateCode: null, name: null, goLiveAt: null, countryCode: null };

export function parseRegionAccess(raw: unknown): RegionAccess {
  if (!raw || typeof raw !== 'object') return REGION_OPEN;
  const o = raw as Record<string, unknown>;
  // an error answer, or one that does not say "not allowed" outright, lets the customer in
  if (o.error === true || o.allowed !== false) {
    return { ...REGION_OPEN, enforced: o.enforced === true, status: typeof o.status === 'string' ? o.status : 'live' };
  }
  return {
    enforced: o.enforced === true,
    allowed: false,
    status: typeof o.status === 'string' ? o.status : 'off',
    stateCode: typeof o.stateCode === 'string' ? o.stateCode : null,
    name: typeof o.name === 'string' ? o.name : null,
    goLiveAt: typeof o.goLiveAt === 'string' ? o.goLiveAt : null,
    countryCode: typeof o.countryCode === 'string' ? o.countryCode : null,
  };
}

// Show the "Coming soon" screen instead of restaurants.
export function isBlocked(access: RegionAccess | null | undefined): boolean {
  return !!access && access.enforced && !access.allowed;
}

export function formatOpenDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

// The words on the Coming soon screen.
export function comingSoonCopy(access: RegionAccess): { title: string; body: string; waitlistPlace: string | null } {
  if (access.status === 'not_us') {
    return {
      title: 'Coming soon to your area',
      body: 'We are only open in the United States for now. Leave your email and we will tell you when we reach you.',
      waitlistPlace: access.countryCode,
    };
  }
  const place = access.name ?? 'your state';
  const date = formatOpenDate(access.goLiveAt);
  return {
    title: `We are not in ${place} yet`,
    body: date
      ? `We open in ${place} on ${date}. Leave your email and we will remind you.`
      : `We are opening state by state. Leave your email and we will tell you as soon as we open in ${place}.`,
    waitlistPlace: access.stateCode,
  };
}

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
}

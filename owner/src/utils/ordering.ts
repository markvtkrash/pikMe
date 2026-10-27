// Pure helpers for the owner's Online Ordering page: prices typed as dollars, and what is still missing before ordering can be turned on.
// The server (migration 165) enforces the same rules; these let the page say what is missing before the owner presses the switch.

export const MAX_PRICE_CENTS = 1_000_000;
export const MIN_PREP_MINUTES = 5;
export const MAX_PREP_MINUTES = 240;
export const PREP_STEP_MINUTES = 5;

export type PriceParse = { ok: true; cents: number | null } | { ok: false; error: string };

// "12", "12.5", "$12.50", "1,250" -> cents. Blank means "no price" (null). More than two decimals, text, zero or over $10,000 are refused.
export function parsePriceToCents(text: string): PriceParse {
  const cleaned = text.replace(/[\s$,]/g, '');
  if (cleaned === '') return { ok: true, cents: null };
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(cleaned)) return { ok: false, error: 'Enter a price like 12.50' };
  const cents = Math.round(parseFloat(cleaned) * 100);
  if (cents < 1) return { ok: false, error: 'The price must be more than $0.00' };
  if (cents > MAX_PRICE_CENTS) return { ok: false, error: 'The price can be at most $10,000.00' };
  return { ok: true, cents };
}

// 1250 -> "12.50" (what goes in the box); null -> "".
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export interface PricedItem {
  item_id: string;
  name: string;
  is_verified: boolean;
  is_out_of_stock?: boolean | null;
  price_cents?: number | null;
}

// A dish a customer could order: confirmed, in stock, with a price (the server's rule in _orderable_item_count).
export function isOrderable(item: PricedItem): boolean {
  return !!item.is_verified && !item.is_out_of_stock && item.price_cents !== null && item.price_cents !== undefined;
}

export function countOrderable(items: PricedItem[]): number {
  return items.filter(isOrderable).length;
}

export interface ReadinessInput {
  status: string;
  timezone: string | null | undefined;
  items: PricedItem[];
  isFranchise: boolean;
  // Stripe: when ordering needs a connected account (the admin setting), whether it can take payments. Left out = not asked about.
  payments?: { required: boolean; ready: boolean };
}

export interface Requirement {
  key: 'approved' | 'timezone' | 'dish' | 'independent' | 'payments';
  met: boolean;
  text: string;
}

// What must be true before ordering can be turned on, each with whether it is true now.
export function orderingRequirements({ status, timezone, items, isFranchise, payments }: ReadinessInput): Requirement[] {
  const list: Requirement[] = [
    { key: 'independent', met: !isFranchise, text: 'Your restaurant is not part of a franchise chain' },
    { key: 'approved', met: status === 'approved', text: 'Your restaurant is approved' },
    { key: 'timezone', met: !!timezone, text: 'Your timezone is set' },
    { key: 'dish', met: countOrderable(items) >= 1, text: 'At least one confirmed dish has a price' },
  ];
  if (payments?.required) list.push({ key: 'payments', met: payments.ready, text: 'Your bank account is connected with Stripe (Tools, Get Paid)' });
  return list;
}

export function canTurnOn(input: ReadinessInput): boolean {
  return orderingRequirements(input).every((r) => r.met);
}

// ── Timezone choices ────────────────────────────────────────────────────────
export const TIMEZONE_CHOICES: { name: string; label: string }[] = [
  { name: 'America/New_York', label: 'Eastern' },
  { name: 'America/Chicago', label: 'Central' },
  { name: 'America/Denver', label: 'Mountain' },
  { name: 'America/Phoenix', label: 'Arizona' },
  { name: 'America/Los_Angeles', label: 'Pacific' },
  { name: 'America/Anchorage', label: 'Alaska' },
  { name: 'Pacific/Honolulu', label: 'Hawaii' },
];

export function timezoneLabel(name: string | null | undefined): string {
  if (!name) return 'Not set';
  const known = TIMEZONE_CHOICES.find((t) => t.name === name);
  return known ? `${known.label} (${name})` : name;
}

// The timezone this device is in, as a name the database knows; null when it cannot be read.
export function deviceTimezone(): string | null {
  try {
    const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof name === 'string' && name.includes('/') ? name : null;
  } catch {
    return null;
  }
}

export function clampPrep(minutes: number): number {
  return Math.min(MAX_PREP_MINUTES, Math.max(MIN_PREP_MINUTES, Math.round(minutes)));
}

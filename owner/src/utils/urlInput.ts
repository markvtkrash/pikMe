// Cleans a web address an owner typed: blank becomes null (clears the field), "example.com/menu" gets https://, and
// something that is not a valid address is returned as typed so the save fails with a clear message rather than the
// value being silently dropped.
export function normalizeUrl(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).toString();
  } catch {
    return trimmed;
  }
}

// True when the typed text is an http or https address the crawler could read (after normalizing).
export function isReadableWebAddress(value: string): boolean {
  const normalized = normalizeUrl(value);
  if (!normalized) return false;
  try {
    const u = new URL(normalized);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

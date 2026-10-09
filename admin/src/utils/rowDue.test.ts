import { formatChecked, isDueForLookup, markedDueTimestamp } from './chainMenuSources';

describe('isDueForLookup', () => {
  const now = new Date('2026-10-05T12:00:00Z');

  it('is due when the chain was never looked up or the date is unusable', () => {
    expect(isDueForLookup(null, now)).toBe(true);
    expect(isDueForLookup('garbage', now)).toBe(true);
    expect(isDueForLookup('', now)).toBe(true);
  });

  it('is not due after a recent lookup', () => {
    expect(isDueForLookup('2026-10-05T08:00:00Z', now)).toBe(false);
    expect(isDueForLookup('2026-09-10T12:00:00Z', now)).toBe(false);
    expect(isDueForLookup('2025-10-06T12:00:00Z', now)).toBe(false); // 364 days
  });

  it('is due once the last lookup has been marked old (400 days)', () => {
    expect(isDueForLookup('2025-10-05T12:00:00Z', now)).toBe(true);  // exactly 365 days
    expect(isDueForLookup('2025-08-31T12:00:00Z', now)).toBe(true);  // 400 days
  });
});

describe('markedDueTimestamp', () => {
  const now = new Date('2026-10-05T12:00:00Z');

  it('is 400 days in the past, like the database sets it', () => {
    const when = new Date(markedDueTimestamp(now));
    expect(Math.round((now.getTime() - when.getTime()) / 86_400_000)).toBe(400);
  });

  it('makes the chain read as due, in both the label and the due check', () => {
    const when = markedDueTimestamp(now);
    expect(isDueForLookup(when, now)).toBe(true);
    expect(formatChecked(when, now)).toBe('due for a new lookup');
  });

  it('is a valid ISO date string', () => {
    expect(Number.isNaN(Date.parse(markedDueTimestamp()))).toBe(false);
  });
});

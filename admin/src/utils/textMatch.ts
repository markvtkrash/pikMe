// Strips punctuation/whitespace so "Dunkin Donuts" matches "Dunkin' Donuts",
// "mac n cheese" matches "Mac & Cheese", etc. — a plain .includes() on raw
// strings fails on apostrophes, spacing, and ampersands that don't match
// character-for-character even when the search is obviously correct.
export function normalizeForSearch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

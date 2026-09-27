// Plain Levenshtein-based similarity, normalized to 0–1 (1 = identical).
// No external dependency — good enough for catching typos, extra
// parentheticals, and minor formatting differences between a pasted name
// and an existing menu item name, without needing an AI call for the common
// case. Genuinely ambiguous names fall through to AI matching instead (see
// match-menu-item-names edge function) rather than this trying to get
// cleverer about word order/synonyms, which is exactly where a dumb edit-
// distance score starts producing false-positive matches.
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const currRow = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,      // deletion
        currRow[j - 1] + 1,  // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    prevRow = currRow;
  }
  return prevRow[n];
}

// Strips punctuation/parentheticals and collapses whitespace before
// comparing, so "Chicken Tikka Masala (Large)" and "chicken tikka masala"
// score as near-identical rather than being penalized for the formatting
// difference alone.
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const distance = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - distance / maxLen;
}

// Best candidate above a confidence floor, or null if nothing clears it —
// used to auto-resolve high-confidence fuzzy matches without any
// confirmation step (reserved for genuinely close matches only; anything
// looser goes through AI + an explicit owner confirm instead).
export function bestFuzzyMatch(
  name: string,
  candidates: string[],
  threshold = 0.85
): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = similarity(name, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= threshold ? best : null;
}

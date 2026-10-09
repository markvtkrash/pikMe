// Pure helpers for extract-menu-from-image (kept apart from index.ts so they can be unit tested).
// An edge function is deployed on its own, so this is its own copy of the setting parser rather than an import
// from extract-menu-from-text.

export const DEFAULT_PHOTO_EXTRACT_MAX_TOKENS = 8192;
export const MIN_PHOTO_EXTRACT_MAX_TOKENS = 1024;
export const MAX_PHOTO_EXTRACT_MAX_TOKENS = 32000;

// The photoExtractMaxTokens setting (app_config, else the env var, else the default). A blank, non-numeric or
// out-of-range value is ignored in favour of the default, so a bad setting can never stop extraction.
export function parsePhotoMaxTokens(...candidates: (string | null | undefined)[]): number {
  for (const raw of candidates) {
    const text = (raw ?? '').trim();
    if (!/^[0-9]{1,6}$/.test(text)) continue;
    const n = Number(text);
    if (n >= MIN_PHOTO_EXTRACT_MAX_TOKENS && n <= MAX_PHOTO_EXTRACT_MAX_TOKENS) return n;
  }
  return DEFAULT_PHOTO_EXTRACT_MAX_TOKENS;
}

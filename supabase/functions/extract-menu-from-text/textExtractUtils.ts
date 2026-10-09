// Pure helpers for extract-menu-from-text (kept apart from index.ts so they can be unit tested).

export const DEFAULT_TEXT_EXTRACT_MAX_TOKENS = 8192;
export const MIN_TEXT_EXTRACT_MAX_TOKENS = 1024;
export const MAX_TEXT_EXTRACT_MAX_TOKENS = 32000;

// The textExtractMaxTokens setting (app_config, else the env var, else the default). A blank, non-numeric or
// out-of-range value is ignored in favour of the default, so a bad setting can never stop extraction.
export function parseMaxTokens(...candidates: (string | null | undefined)[]): number {
  for (const raw of candidates) {
    const text = (raw ?? '').trim();
    if (!/^[0-9]{1,6}$/.test(text)) continue;
    const n = Number(text);
    if (n >= MIN_TEXT_EXTRACT_MAX_TOKENS && n <= MAX_TEXT_EXTRACT_MAX_TOKENS) return n;
  }
  return DEFAULT_TEXT_EXTRACT_MAX_TOKENS;
}

// The menuFromTextModel setting (app_config, else the MENU_FROM_TEXT_MODEL env var): the AI model used only for reading
// pasted menu text. Returns the first usable model name, or null meaning "use the app-wide model of the active
// provider" (quicksilverModel / claudeModel). Only plain model-name characters are accepted, so a stray value can
// never reach the AI request.
export function pickModel(...candidates: (string | null | undefined)[]): string | null {
  for (const raw of candidates) {
    const name = (raw ?? '').trim();
    if (/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,99}$/.test(name)) return name;
  }
  return null;
}

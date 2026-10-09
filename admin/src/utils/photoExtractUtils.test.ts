// Tests for the photoExtractMaxTokens setting read by the extract-menu-from-image edge function.
import {
  DEFAULT_PHOTO_EXTRACT_MAX_TOKENS, MAX_PHOTO_EXTRACT_MAX_TOKENS, MIN_PHOTO_EXTRACT_MAX_TOKENS, parsePhotoMaxTokens,
} from '../../../supabase/functions/extract-menu-from-image/photoExtractUtils';

describe('parsePhotoMaxTokens', () => {
  it('defaults to 8192, well above the old fixed 2048 that cut off long menus', () => {
    expect(DEFAULT_PHOTO_EXTRACT_MAX_TOKENS).toBe(8192);
    expect(parsePhotoMaxTokens()).toBe(8192);
    expect(parsePhotoMaxTokens(undefined, undefined)).toBe(8192);
  });

  it('uses a valid setting, trimmed', () => {
    expect(parsePhotoMaxTokens('4096')).toBe(4096);
    expect(parsePhotoMaxTokens(' 16000 ')).toBe(16000);
    expect(parsePhotoMaxTokens(String(MIN_PHOTO_EXTRACT_MAX_TOKENS))).toBe(MIN_PHOTO_EXTRACT_MAX_TOKENS);
    expect(parsePhotoMaxTokens(String(MAX_PHOTO_EXTRACT_MAX_TOKENS))).toBe(MAX_PHOTO_EXTRACT_MAX_TOKENS);
  });

  it('ignores blank, non-numeric and out-of-range values, so a bad setting never stops extraction', () => {
    for (const bad of ['', '  ', 'abc', '12.5', '-5', '1e4', '1023', '32001', '99999999']) {
      expect(parsePhotoMaxTokens(bad)).toBe(8192);
    }
  });

  it('falls through to the next candidate (the env var) when the setting is unusable', () => {
    expect(parsePhotoMaxTokens('', '6000')).toBe(6000);
    expect(parsePhotoMaxTokens('nope', '6000')).toBe(6000);
    expect(parsePhotoMaxTokens('5000', '6000')).toBe(5000);
    expect(parsePhotoMaxTokens(null, 'bad')).toBe(8192);
  });
});

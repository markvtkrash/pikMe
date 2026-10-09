// Tests for the textExtractMaxTokens setting read by the extract-menu-from-text edge function.
import {
  DEFAULT_TEXT_EXTRACT_MAX_TOKENS, MAX_TEXT_EXTRACT_MAX_TOKENS, MIN_TEXT_EXTRACT_MAX_TOKENS, parseMaxTokens, pickModel,
} from '../../../supabase/functions/extract-menu-from-text/textExtractUtils';

describe('parseMaxTokens', () => {
  it('defaults to 8192, well above the old fixed 2048 that cut off long pasted menus', () => {
    expect(DEFAULT_TEXT_EXTRACT_MAX_TOKENS).toBe(8192);
    expect(parseMaxTokens()).toBe(8192);
    expect(parseMaxTokens(undefined, undefined)).toBe(8192);
  });

  it('uses a valid setting, trimmed', () => {
    expect(parseMaxTokens('4096')).toBe(4096);
    expect(parseMaxTokens(' 16000 ')).toBe(16000);
    expect(parseMaxTokens(String(MIN_TEXT_EXTRACT_MAX_TOKENS))).toBe(MIN_TEXT_EXTRACT_MAX_TOKENS);
    expect(parseMaxTokens(String(MAX_TEXT_EXTRACT_MAX_TOKENS))).toBe(MAX_TEXT_EXTRACT_MAX_TOKENS);
  });

  it('ignores blank, non-numeric and out-of-range values, so a bad setting never stops extraction', () => {
    for (const bad of ['', '  ', 'abc', '12.5', '-5', '1e4', '1023', '32001', '99999999']) {
      expect(parseMaxTokens(bad)).toBe(8192);
    }
  });

  it('falls through to the next candidate (the env var) when the setting is unusable', () => {
    expect(parseMaxTokens('', '6000')).toBe(6000);
    expect(parseMaxTokens('nope', '6000')).toBe(6000);
    expect(parseMaxTokens('5000', '6000')).toBe(5000);
    expect(parseMaxTokens(null, 'bad')).toBe(8192);
  });
});

describe('pickModel (the menuFromTextModel setting)', () => {
  it('returns null (use the app-wide model) when nothing usable is set', () => {
    expect(pickModel()).toBeNull();
    expect(pickModel('', '  ', null, undefined)).toBeNull();
  });

  it('returns the first usable name, trimmed, setting before env var', () => {
    expect(pickModel(' qwen3.8-max ')).toBe('qwen3.8-max');
    expect(pickModel('claude-haiku-4-5-20251001', 'other')).toBe('claude-haiku-4-5-20251001');
    expect(pickModel('', 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
    expect(pickModel('org/model:latest')).toBe('org/model:latest');
  });

  it('ignores anything that is not a plain model name, falling through to the next candidate', () => {
    for (const bad of ['two words', 'bad"quote', 'new\nline', '-leading-dash', '{"x":1}', 'a'.repeat(101)]) {
      expect(pickModel(bad)).toBeNull();
    }
    expect(pickModel('bad name', 'good-model')).toBe('good-model');
  });
});

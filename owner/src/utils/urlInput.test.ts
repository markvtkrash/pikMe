import { isReadableWebAddress, normalizeUrl } from './urlInput';

describe('normalizeUrl', () => {
  it('turns blank into null, which clears the field', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl(undefined as any)).toBeNull();
  });

  it('adds https:// when it is missing and tidies the address', () => {
    expect(normalizeUrl('example.com/menu')).toBe('https://example.com/menu');
    expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com/');
    expect(normalizeUrl('HTTP://Example.com/Menu')).toBe('http://example.com/Menu');
  });

  it('returns text that is not an address as typed, so the save can fail clearly', () => {
    expect(normalizeUrl('not a url at all')).toBe('not a url at all');
  });
});

describe('isReadableWebAddress', () => {
  it('accepts a normal web address, with or without https://', () => {
    expect(isReadableWebAddress('example.com/menu')).toBe(true);
    expect(isReadableWebAddress('https://www.example.com/menu')).toBe(true);
    expect(isReadableWebAddress('http://example.com')).toBe(true);
  });

  it('refuses blank text, other kinds of address and anything that is not an address', () => {
    for (const bad of ['', '   ', 'not a url at all', 'ftp://example.com/x', 'javascript:alert(1)', 'localhost', 'https://nodots']) {
      expect(isReadableWebAddress(bad)).toBe(false);
    }
  });
});

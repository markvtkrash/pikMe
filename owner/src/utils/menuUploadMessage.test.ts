import { menuUploadMessage } from './menuUploadMessage';

describe('menuUploadMessage', () => {
  it('uses the singular for exactly one item', () => {
    expect(menuUploadMessage(1, 'photo')).toBe('1 menu item added to your menu from your photo.');
  });

  it('uses the plural and the count for several items', () => {
    expect(menuUploadMessage(12, 'photo')).toBe('12 menu items added to your menu from your photo.');
    expect(menuUploadMessage(2, 'photo')).toBe('2 menu items added to your menu from your photo.');
  });

  it('mentions the source', () => {
    expect(menuUploadMessage(3, 'text')).toBe('3 menu items added to your menu from your text.');
  });

  it('says nothing new was added for zero, per source', () => {
    expect(menuUploadMessage(0, 'photo')).toMatch(/^No new menu items were added/);
    expect(menuUploadMessage(0, 'photo')).toMatch(/photo/);
    expect(menuUploadMessage(0, 'text')).toMatch(/text/);
  });

  it('never claims "0 items added" or a negative/NaN count', () => {
    for (const bad of [0, -3, NaN, undefined, null, 'abc', Infinity]) {
      const message = menuUploadMessage(bad, 'photo');
      expect(message).toMatch(/^No new menu items were added/);
      expect(message).not.toMatch(/NaN|undefined|null|-3|Infinity/);
    }
  });

  it('accepts a numeric string from the server', () => {
    expect(menuUploadMessage('5', 'photo')).toBe('5 menu items added to your menu from your photo.');
  });

  it('rounds a fractional count down', () => {
    expect(menuUploadMessage(2.9, 'photo')).toBe('2 menu items added to your menu from your photo.');
  });
});

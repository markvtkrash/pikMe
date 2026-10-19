import { darkColor, darkStyle, darkStyles } from './darkColors';

describe('darkColor', () => {
  it('turns white and the light grays into the same flat "light black" surface', () => {
    expect(darkColor('#fff')).toBe('#161616');
    expect(darkColor('#ffffff')).toBe('#161616');
    expect(darkColor('#F9F9F9')).toBe('#161616');
    expect(darkColor('#f0f0f0')).toBe('#161616');
  });

  it('turns dark text into plain white', () => {
    expect(darkColor('#1a1a1a', 'color')).toBe('#ffffff');
    expect(darkColor('#333333', 'color')).toBe('#ffffff');
  });

  it('keeps white text white, and dark backgrounds dark', () => {
    expect(darkColor('#fff', 'color')).toBe('#fff');
    expect(darkColor('rgba(0,0,0,0.5)')).toBe('rgba(0,0,0,0.5)');
  });

  it('keeps button blues as backgrounds but lightens them as text', () => {
    expect(darkColor('#1565C0', 'backgroundColor')).toBe('#1565C0');
    expect(darkColor('#1565C0', 'color')).not.toBe('#1565C0');
  });

  it('turns pale tints into dark tints of the same hue', () => {
    const out = darkColor('#E3F2FD');
    expect(out).toMatch(/^#[0-5]/);
    expect(out).not.toBe('#e3f2fd');
  });

  it('keeps alpha and leaves shadows and unknown values alone', () => {
    expect(darkColor('rgba(255,255,255,0.92)')).toBe('rgba(22, 22, 22, 0.92)');
    expect(darkColor('#000', 'shadowColor')).toBe('#000');
    expect(darkColor('transparent')).toBe('transparent');
    expect(darkColor('not-a-color')).toBe('not-a-color');
  });
});

describe('darkStyle / darkStyles', () => {
  it('translates color properties and leaves the rest', () => {
    expect(darkStyle({ backgroundColor: '#fff', color: '#1a1a1a', padding: 8, fontWeight: '700' })).toEqual({
      backgroundColor: '#161616',
      color: darkColor('#1a1a1a', 'color'),
      padding: 8,
      fontWeight: '700',
    });
  });

  it('walks a whole StyleSheet and nested objects', () => {
    const out = darkStyles({ card: { backgroundColor: '#fff', shadowOffset: { width: 0, height: 2 } }, t: { color: '#888' } });
    expect(out.card.backgroundColor).toBe('#161616');
    expect(out.card.shadowOffset).toEqual({ width: 0, height: 2 });
    expect(out.t.color).toBeDefined();
  });
});

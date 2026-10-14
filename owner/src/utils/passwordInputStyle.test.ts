import { splitInputStyle } from './passwordInputStyle';

describe('splitInputStyle', () => {
  it('gives the wrapper the margins and size, and the text box the rest', () => {
    const { outer, inner } = splitInputStyle({ marginBottom: 12, width: '100%', borderWidth: 1, padding: 10, fontSize: 15 });
    expect(outer).toEqual({ marginBottom: 12, width: '100%' });
    expect(inner).toEqual({ borderWidth: 1, padding: 10, fontSize: 15 });
  });

  it('flattens a list of styles, later ones winning', () => {
    const { outer, inner } = splitInputStyle([{ marginTop: 4, borderColor: 'red' }, false, { marginTop: 8, flex: 1 }]);
    expect(outer).toEqual({ marginTop: 8, flex: 1 });
    expect(inner).toEqual({ borderColor: 'red' });
  });

  it('copes with no style', () => {
    expect(splitInputStyle(undefined)).toEqual({ outer: {}, inner: {} });
  });
});

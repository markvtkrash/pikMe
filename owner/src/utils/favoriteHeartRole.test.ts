import { favoriteHeartRole } from './favoriteHeartRole';

describe('favoriteHeartRole', () => {
  it('does not claim the button role on the web, where the heart sits inside a button', () => {
    expect(favoriteHeartRole('web')).toBeUndefined();
  });
  it('keeps the button role on phones', () => {
    expect(favoriteHeartRole('ios')).toBe('button');
    expect(favoriteHeartRole('android')).toBe('button');
  });
});

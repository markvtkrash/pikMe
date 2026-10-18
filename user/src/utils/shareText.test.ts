import { dishShareMessage, restaurantShareMessage } from './shareText';
import { shareText, type ShareEnv } from './share';

describe('restaurantShareMessage', () => {
  it('names the restaurant and the app, with the cuisine and address on their own parts', () => {
    expect(restaurantShareMessage({ name: 'Magic Noodle', address: '8013 W 159th St, Overland Park, KS', cuisine: 'Asian' }))
      .toBe('Check out Magic Noodle on VectraVibe. Asian.\n8013 W 159th St, Overland Park, KS');
  });
  it('leaves out what is missing', () => {
    expect(restaurantShareMessage({ name: 'Magic Noodle' })).toBe('Check out Magic Noodle on VectraVibe.');
    expect(restaurantShareMessage({ name: 'Magic Noodle', cuisine: 'Asian', address: '' })).toBe('Check out Magic Noodle on VectraVibe. Asian.');
    expect(restaurantShareMessage({ name: 'Magic Noodle', address: '1 Main St', cuisine: null })).toBe('Check out Magic Noodle on VectraVibe.\n1 Main St');
  });
  it('does not double a full stop that the cuisine already ends with', () => {
    expect(restaurantShareMessage({ name: 'A', cuisine: 'Cafe.' })).toBe('Check out A on VectraVibe. Cafe.');
  });
  it('is empty without a name', () => {
    expect(restaurantShareMessage({ name: '' })).toBe('');
    expect(restaurantShareMessage({ name: '   ' })).toBe('');
  });
  it('tidies spaces and caps a very long name', () => {
    expect(restaurantShareMessage({ name: '  Magic   Noodle \n House ' })).toBe('Check out Magic Noodle House on VectraVibe.');
    expect(restaurantShareMessage({ name: 'x'.repeat(200) }).length).toBeLessThan(120);
  });
  it('makes no health, safety or "best" claim', () => {
    const msg = restaurantShareMessage({ name: 'Magic Noodle', address: '1 Main St', cuisine: 'Asian' }).toLowerCase();
    for (const w of ['healthy', 'best', 'safe', 'allerg', 'chain']) expect(msg).not.toContain(w);
  });
});

describe('dishShareMessage', () => {
  it('names the dish, the restaurant and the app', () => {
    expect(dishShareMessage({ dish: 'Egg Rolls (2 pc)', restaurantName: 'Magic Noodle', confirmed: true }))
      .toBe('Egg Rolls (2 pc) at Magic Noodle, on VectraVibe.');
  });
  it('says "estimated menu" for a dish the restaurant has not confirmed', () => {
    expect(dishShareMessage({ dish: 'Egg Rolls', restaurantName: 'Magic Noodle', confirmed: false }))
      .toBe('Egg Rolls at Magic Noodle, on VectraVibe (estimated menu).');
  });
  it('is empty when the dish or the restaurant has no name', () => {
    expect(dishShareMessage({ dish: '', restaurantName: 'A', confirmed: true })).toBe('');
    expect(dishShareMessage({ dish: 'B', restaurantName: ' ', confirmed: true })).toBe('');
  });
  it('carries no nutrition numbers or health claims', () => {
    const msg = dishShareMessage({ dish: 'Cucumber Salad', restaurantName: 'Magic Noodle', confirmed: false }).toLowerCase();
    for (const w of ['calorie', 'protein', 'healthy', 'low carb', 'safe', 'allerg']) expect(msg).not.toContain(w);
  });
});

describe('shareText', () => {
  const native = (action: string): ShareEnv => ({
    os: 'ios', nativeShare: jest.fn().mockResolvedValue({ action }), nativeDismissedAction: 'dismissedAction',
  });

  it('on a phone: shared, or dismissed when the sheet is closed', async () => {
    expect(await shareText('hello', native('sharedAction'))).toBe('shared');
    expect(await shareText('hello', native('dismissedAction'))).toBe('dismissed');
  });
  it('on a phone: passes the text to the share sheet', async () => {
    const env = native('sharedAction');
    await shareText('  hello  ', env);
    expect(env.nativeShare).toHaveBeenCalledWith({ message: 'hello' });
  });
  it('on a phone: a failure is "failed", never a crash', async () => {
    expect(await shareText('hi', { os: 'android', nativeShare: jest.fn().mockRejectedValue(new Error('boom')), nativeDismissedAction: 'd' })).toBe('failed');
    expect(await shareText('hi', { os: 'android' })).toBe('failed');
  });
  it('on the web: uses the browser share sheet when there is one', async () => {
    const webShare = jest.fn().mockResolvedValue(undefined);
    expect(await shareText('hi', { os: 'web', webShare, writeClipboard: jest.fn() })).toBe('shared');
    expect(webShare).toHaveBeenCalledWith({ text: 'hi' });
  });
  it('on the web: closing the browser sheet is "dismissed", with nothing copied', async () => {
    const writeClipboard = jest.fn();
    const webShare = jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    expect(await shareText('hi', { os: 'web', webShare, writeClipboard })).toBe('dismissed');
    expect(writeClipboard).not.toHaveBeenCalled();
  });
  it('on the web: another browser-share failure falls back to the clipboard', async () => {
    const writeClipboard = jest.fn().mockResolvedValue(undefined);
    const webShare = jest.fn().mockRejectedValue(new Error('NotAllowedError'));
    expect(await shareText('hi', { os: 'web', webShare, writeClipboard })).toBe('copied');
    expect(writeClipboard).toHaveBeenCalledWith('hi');
  });
  it('on the web with no share sheet: copies the text', async () => {
    const writeClipboard = jest.fn().mockResolvedValue(undefined);
    expect(await shareText('hi', { os: 'web', writeClipboard })).toBe('copied');
  });
  it('on the web with neither, or a clipboard that fails: failed', async () => {
    expect(await shareText('hi', { os: 'web' })).toBe('failed');
    expect(await shareText('hi', { os: 'web', writeClipboard: jest.fn().mockRejectedValue(new Error('denied')) })).toBe('failed');
  });
  it('an empty message is never shared', async () => {
    const env = native('sharedAction');
    expect(await shareText('   ', env)).toBe('failed');
    expect(env.nativeShare).not.toHaveBeenCalled();
  });
});

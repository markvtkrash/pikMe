import { confirmAndRetryIfNeeded } from './menuReplaceConfirm';
import { useAlertStore } from '../store/alertStore';

// The question is shown in the modal window; these helpers read it and press its buttons.
const shown = () => useAlertStore.getState();
function press(index: number) {
  const { buttons } = shown();
  shown().hide();
  buttons[index].onPress?.();
}
const waitForDialog = async () => {
  for (let i = 0; i < 20 && !shown().visible; i++) await Promise.resolve();
};

describe('confirmAndRetryIfNeeded', () => {
  beforeEach(() => shown().hide());

  const needs = { requiresConfirmation: true, overwritesVerifiedCount: 3, affectedCoupons: [] } as any;

  it('returns the result untouched when nothing needs confirming', async () => {
    const retry = jest.fn();
    const result = { requiresConfirmation: false, itemCount: 4 } as any;
    expect(await confirmAndRetryIfNeeded(result, retry)).toBe(result);
    expect(retry).not.toHaveBeenCalled();
    expect(shown().visible).toBe(false);
  });

  it('says items will be REMOVED when the owner is saving an empty menu', async () => {
    const retry = jest.fn().mockResolvedValue({ itemCount: 0 });
    const done = confirmAndRetryIfNeeded(needs, retry, true);
    await waitForDialog();
    const message = shown().message as string;
    expect(message).toMatch(/3 verified menu items will be removed and your menu will be empty/);
    expect(message).not.toMatch(/AI-guessed/);
    press(1);
    await done;
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the replace wording for a normal save', async () => {
    const done = confirmAndRetryIfNeeded(needs, jest.fn().mockResolvedValue({}));
    await waitForDialog();
    expect(shown().message).toMatch(/replaced with AI-guessed items/);
    press(1);
    await done;
  });

  it('does nothing when the owner declines, or closes the window', async () => {
    const retry = jest.fn();
    const declined = confirmAndRetryIfNeeded(needs, retry, true);
    await waitForDialog();
    press(0);
    expect(await declined).toBe(needs);

    const closed = confirmAndRetryIfNeeded(needs, retry, true);
    await waitForDialog();
    shown().dismiss();
    expect(await closed).toBe(needs);
    expect(retry).not.toHaveBeenCalled();
  });
});

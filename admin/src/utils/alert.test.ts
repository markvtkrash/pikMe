import { Alert, confirmDialog } from './alert';
import { useAlertStore } from '../store/alertStore';

const press = (i: number) => {
  const { buttons } = useAlertStore.getState();
  useAlertStore.getState().hide();
  buttons[i].onPress?.();
};

beforeEach(() => useAlertStore.getState().hide());

describe('confirmDialog', () => {
  it('shows a modal with Cancel and the confirm button', () => {
    confirmDialog('Delete?', 'Sure?', { confirmText: 'Delete', destructive: true });
    const s = useAlertStore.getState();
    expect(s.visible).toBe(true);
    expect([s.title, s.message]).toEqual(['Delete?', 'Sure?']);
    expect(s.buttons.map((b) => [b.text, b.style])).toEqual([['Cancel', 'cancel'], ['Delete', 'destructive']]);
  });

  it('resolves true on confirm and false on cancel', async () => {
    const yes = confirmDialog('Q');
    press(1);
    await expect(yes).resolves.toBe(true);
    const no = confirmDialog('Q');
    press(0);
    await expect(no).resolves.toBe(false);
  });

  it('resolves false when closed with Escape/back', async () => {
    const p = confirmDialog('Q');
    useAlertStore.getState().dismiss();
    await expect(p).resolves.toBe(false);
    expect(useAlertStore.getState().visible).toBe(false);
  });

  it('resolves false when another dialog replaces it', async () => {
    const p = confirmDialog('First');
    Alert.alert('Second');
    await expect(p).resolves.toBe(false);
    expect(useAlertStore.getState().title).toBe('Second');
  });
});

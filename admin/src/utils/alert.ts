import { useAlertStore, AlertButton } from '../store/alertStore';

// Drop-in replacement for react-native's Alert — same call shape
// (Alert.alert(title, message?, buttons?)) — so every existing call site
// works unchanged. Renders as an on-screen Modal via AlertModalHost
// (react-native-web's own Alert.alert() is a no-op).
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    useAlertStore.getState().show(title, message, buttons);
  },
};

export interface ConfirmOptions {
  confirmText?: string;
  cancelText?: string;
  // red confirm button, for deleting or removing something
  destructive?: boolean;
}

// A yes/no question in the same modal window, instead of the browser's own confirm() box. Resolves true when the
// confirm button is pressed, and false for Cancel, Escape/back, or when another dialog replaces it.
export function confirmDialog(title: string, message?: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useAlertStore.getState().show(
      title,
      message,
      [
        { text: options.cancelText ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: options.confirmText ?? 'OK', style: options.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      () => resolve(false)
    );
  });
}

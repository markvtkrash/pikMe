import { create } from 'zustand';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface AlertState {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AlertButton[];
  // Called when the dialog is closed without pressing a button (Escape / back), or replaced by another dialog.
  onDismiss?: () => void;
  show: (title: string, message?: string, buttons?: AlertButton[], onDismiss?: () => void) => void;
  hide: () => void;
  dismiss: () => void;
}

// Backs the drop-in Alert replacement in ../utils/alert.ts — react-native-web's
// real Alert.alert() is a no-op (empty function body), so every call site
// using it was silently swallowed on web, this app's primary platform.
export const useAlertStore = create<AlertState>((set, get) => ({
  visible: false,
  title: '',
  message: undefined,
  buttons: [{ text: 'OK' }],
  onDismiss: undefined,
  show: (title, message, buttons, onDismiss) => {
    // A dialog still open when another arrives counts as dismissed, so nobody waits on it forever.
    const { visible, onDismiss: pending } = get();
    if (visible && pending) pending();
    set({
      visible: true,
      title,
      message,
      buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
      onDismiss,
    });
  },
  hide: () => set({ visible: false, onDismiss: undefined }),
  dismiss: () => {
    const { onDismiss } = get();
    set({ visible: false, onDismiss: undefined });
    onDismiss?.();
  },
}));

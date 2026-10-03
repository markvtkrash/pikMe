import { useAlertStore, AlertButton } from '../store/alertStore';

// Drop-in replacement for react-native's Alert — same call shape
// (Alert.alert(title, message?, buttons?)) — so every existing call site
// works unchanged; only the import source changes (from 'react-native' to
// this file). Renders as an actual on-screen Modal via AlertModalHost
// instead of react-native-web's Alert.alert(), which is a no-op on web and
// was silently swallowing every one of these.
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    useAlertStore.getState().show(title, message, buttons);
  },
};

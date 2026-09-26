import Constants from 'expo-constants';

// Idle-logout timeout, in minutes — resets on any mouse/keyboard/touch
// activity; auto-signs-out when it elapses with none. Configurable via
// EXPO_PUBLIC_SESSION_TIMEOUT_MINUTES in this app's own .env; defaults to 30
// if unset or invalid. Deliberately a separate value per app (owner vs
// admin), since each app reads its own .env independently.
export const SESSION_TIMEOUT_MINUTES =
  Number(Constants.expoConfig?.extra?.sessionTimeoutMinutes) || 30;

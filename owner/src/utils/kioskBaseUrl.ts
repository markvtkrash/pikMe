import { Platform } from 'react-native';

// The address the staff link starts with: this site's own address in a browser. The phone app has no address of its own, so it uses
// EXPO_PUBLIC_OWNER_WEB_URL (the owner website's address) when that is set, and otherwise gives none.
export function kioskBaseUrl(): string | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return process.env.EXPO_PUBLIC_OWNER_WEB_URL || null;
}

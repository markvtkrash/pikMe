import { useCallback } from 'react';
import { Platform, Share } from 'react-native';
import { Alert } from '../utils/alert';
import { shareText, type ShareEnv } from '../utils/share';
import { trackEvent } from '../api/analytics';

// The share action for a restaurant or a dish. Counts one anonymous "share" event per thing per launch (the key is not sent), and says so when the text
// was copied instead of shared (the browser has no share sheet) or could not be shared.
function currentEnv(): ShareEnv {
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : undefined;
  return {
    os: Platform.OS,
    nativeShare: (content) => Share.share(content) as Promise<{ action: string }>,
    nativeDismissedAction: Share.dismissedAction,
    webShare: nav && typeof nav.share === 'function' ? (data) => nav.share(data) : undefined,
    writeClipboard: nav?.clipboard?.writeText ? (text) => nav.clipboard.writeText(text) : undefined,
  };
}

export function useShare() {
  return useCallback(async (message: string, kind: 'restaurant' | 'dish', key: string) => {
    if (!message) return;
    const outcome = await shareText(message, currentEnv());
    if (outcome === 'shared' || outcome === 'copied') trackEvent('share', { kind }, key);
    if (outcome === 'copied') Alert.alert('Copied', 'The text is copied. Paste it into a message to share.');
    else if (outcome === 'failed') Alert.alert('Could not share', 'Sharing is not available right now.');
  }, []);
}

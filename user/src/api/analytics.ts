import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import {
  cleanProps, createDeduper, isValidInstallId, newInstallId, shouldSend, type EventName, type EventProps,
} from '../utils/analyticsEvents';

// Anonymous usage events (migration 147). Fire and forget: a failure is ignored, and nothing here ever waits on the network or throws into the app.
// The only identity is a random install ID kept on the phone. No user ID, email, name, location or search text is sent.

const INSTALL_ID_KEY = 'pikme-install-id';
const dedupe = createDeduper();
let installIdPromise: Promise<string | null> | null = null;

function loadInstallId(): Promise<string | null> {
  if (!installIdPromise) {
    installIdPromise = (async () => {
      try {
        const saved = await AsyncStorage.getItem(INSTALL_ID_KEY);
        if (isValidInstallId(saved)) return saved;
        const fresh = newInstallId();
        await AsyncStorage.setItem(INSTALL_ID_KEY, fresh);
        return fresh;
      } catch {
        return null;   // storage unavailable: no events from this launch rather than a new ID every time
      }
    })();
  }
  return installIdPromise;
}

/** Record that something happened. `key` stops the same thing being sent twice in one launch (see shouldSend). */
export function trackEvent(event: EventName, props?: EventProps, key?: string): void {
  if (!shouldSend(dedupe, event, key)) return;
  void (async () => {
    try {
      const installId = await loadInstallId();
      if (!installId) return;
      const platform = Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : null;
      await supabase.rpc('log_app_event', {
        p_install_id: installId,
        p_event: event,
        p_props: cleanProps(props),
        p_platform: platform,
        p_app_version: Constants.expoConfig?.version ?? null,
      });
    } catch {
      // usage numbers must never get in the way of the app
    }
  })();
}

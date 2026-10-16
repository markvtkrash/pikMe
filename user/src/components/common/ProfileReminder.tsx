import { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useUserProfileStore } from '../../store/userProfileStore';
import { useProfileReminderStore } from '../../store/profileReminderStore';
import { useAnnouncementStore } from '../../store/announcementStore';
import { useCustomerConfig } from '../../hooks/useCustomerConfig';
import { nextAnnouncement } from '../../utils/announcements';
import { ONBOARDING_START_PATH } from '../../utils/customerRouting';
import {
  isSnoozed, shouldShowProfileReminder, REMINDER_TITLE, REMINDER_MESSAGE, REMINDER_SETUP_LABEL, REMINDER_LATER_LABEL,
} from '../../utils/profileReminder';
import { useThemedStyles } from '../../theme/useTheme';

// Signing up needs only an email and a password. This window, shown when the app is opened, invites a person who has not set up their food
// preferences to do it (about 2 minutes). "Not now" hides it for a week on this device; finishing the setup, here or from the Profile tab, ends it.
export function ProfileReminder() {
  const styles = useThemedStyles(baseStyles);
  const router = useRouter();
  const segments = useSegments();
  const onboardingComplete = useUserProfileStore((s) => s.onboardingComplete);
  const dismissedAt = useProfileReminderStore((s) => s.dismissedAt);
  const dismiss = useProfileReminderStore((s) => s.dismiss);
  // the remembered "Not now" is read from the device a moment after launch; nothing is shown before it is known
  const [hydrated, setHydrated] = useState(useProfileReminderStore.persist.hasHydrated());
  useEffect(() => {
    const unsubscribe = useProfileReminderStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useProfileReminderStore.persist.hasHydrated());
    return unsubscribe;
  }, []);
  const { data } = useCustomerConfig();
  const seenIds = useAnnouncementStore((s) => s.seenIds);

  const visible = hydrated && shouldShowProfileReminder({
    hasSession: onboardingComplete !== null,
    onboardingComplete,
    segments: segments as string[],
    snoozed: isSnoozed(dismissedAt),
    announcementPending: nextAnnouncement(data?.announcements ?? [], seenIds) !== null,
  });

  function setUpNow() {
    dismiss();
    router.push(ONBOARDING_START_PATH as any);
  }

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.emoji}>🍽️</Text>
          <Text style={styles.title}>{REMINDER_TITLE}</Text>
          <Text style={styles.message}>{REMINDER_MESSAGE}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={setUpNow} accessibilityRole="button">
            <Text style={styles.primaryText}>{REMINDER_SETUP_LABEL}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.laterBtn} onPress={dismiss} accessibilityRole="button">
            <Text style={styles.laterText}>{REMINDER_LATER_LABEL}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const baseStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 22, width: '100%', maxWidth: 380, alignItems: 'center' },
  emoji: { fontSize: 40, marginBottom: 8 },
  title: { fontSize: 19, fontWeight: '800', color: '#222', textAlign: 'center', marginBottom: 8 },
  message: { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 21, marginBottom: 18 },
  primaryBtn: { backgroundColor: '#E65100', borderRadius: 12, paddingVertical: 13, alignSelf: 'stretch', alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  laterBtn: { paddingVertical: 12, paddingHorizontal: 20, marginTop: 4 },
  laterText: { color: '#666', fontSize: 14, fontWeight: '600' },
});

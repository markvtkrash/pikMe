import { Modal, View, Text, TouchableOpacity, StyleSheet, Linking, Pressable } from 'react-native';
import { useCustomerConfig } from '../../hooks/useCustomerConfig';
import { useAnnouncementStore } from '../../store/announcementStore';
import { nextAnnouncement } from '../../utils/announcements';

// Shows the next announcement an admin published that this phone has not shown yet (migration 128), once. An "important" one
// can only be closed with the OK button; an info one can also be closed by tapping outside it. It appears the next time the
// app opens, or when the shared settings refresh (every 10 minutes while the app is in use). Nothing shows if the settings
// could not be read.
export function AnnouncementModal() {
  const { data } = useCustomerConfig();
  const seenIds = useAnnouncementStore((s) => s.seenIds);
  const markSeen = useAnnouncementStore((s) => s.markSeen);
  const current = nextAnnouncement(data?.announcements ?? [], seenIds);

  if (!current) return null;
  const important = current.kind === 'important';

  function dismiss() {
    markSeen(current!.id);
  }

  function openLink() {
    if (current!.linkUrl) Linking.openURL(current!.linkUrl).catch(() => {});
    dismiss();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={important ? undefined : dismiss}>
      <Pressable style={styles.backdrop} onPress={important ? undefined : dismiss}>
        <Pressable style={styles.card} onPress={() => {}} accessibilityRole="alert">
          <Text style={[styles.tag, important && styles.tagImportant]}>{important ? 'Important' : 'News'}</Text>
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.message}>{current.message}</Text>
          {!!current.linkUrl && !!current.linkLabel && (
            <TouchableOpacity style={styles.linkBtn} onPress={openLink} accessibilityRole="button">
              <Text style={styles.linkText}>{current.linkLabel}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.okBtn} onPress={dismiss} accessibilityRole="button">
            <Text style={styles.okText}>OK</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  tag: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '800', color: '#1565C0', backgroundColor: '#E3F2FD', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 10, overflow: 'hidden' },
  tagImportant: { color: '#E65100', backgroundColor: '#FFF3E0' },
  title: { fontSize: 18, fontWeight: '800', color: '#222', marginBottom: 8 },
  message: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 16 },
  linkBtn: { alignSelf: 'flex-start', borderWidth: 1.5, borderColor: '#1565C0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 12 },
  linkText: { color: '#1565C0', fontWeight: '700', fontSize: 14 },
  okBtn: { backgroundColor: '#1565C0', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  okText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

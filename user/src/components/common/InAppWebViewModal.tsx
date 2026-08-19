import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND_COLORS } from '../../constants/brandTheme';

// react-native-web has no built-in <iframe> element — declare it so the JSX
// below type-checks. This file is the web build (Metro picks the .native.tsx
// sibling on iOS/Android), so react-native-webview is never imported here —
// that package throws at module-load time in a browser context.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      iframe: any;
    }
  }
}

interface Props {
  visible: boolean;
  url: string;
  title: string;
  onClose: () => void;
}

export function InAppWebViewModal({ visible, url, title, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={BRAND_COLORS.primary} />
            </View>
          )}

          {visible && (
            <iframe
              src={url}
              style={{ flex: 1, border: 'none', width: '100%', height: '100%' }}
              onLoad={() => setLoading(false)}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  title: { flex: 1, fontSize: 16, fontWeight: '700', color: BRAND_COLORS.text.primary, marginRight: 12 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: BRAND_COLORS.background.overlay, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: 14, fontWeight: '700', color: BRAND_COLORS.text.secondary },
  content: { flex: 1 },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', zIndex: 1,
  },
});

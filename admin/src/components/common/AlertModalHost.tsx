import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { useAlertStore, AlertButton } from '../../store/alertStore';

// Mounted once at the app root (see app/_layout.tsx). Renders whatever the
// drop-in Alert replacement (../../utils/alert.ts) currently has queued —
// every Alert.alert(...) call site in this app ends up here.
export function AlertModalHost() {
  const { visible, title, message, buttons, hide } = useAlertStore();

  function handlePress(btn: AlertButton) {
    hide();
    btn.onPress?.();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={hide}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {!!message && <Text style={styles.message}>{message}</Text>}
          <View style={[styles.btnRow, buttons.length > 2 && styles.btnColumn]}>
            {buttons.map((btn, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.btn,
                  btn.style === 'destructive' && styles.btnDestructive,
                  btn.style === 'cancel' && styles.btnCancel,
                ]}
                onPress={() => handlePress(btn)}
              >
                <Text
                  style={[
                    styles.btnText,
                    btn.style === 'destructive' && styles.btnTextDestructive,
                    btn.style === 'cancel' && styles.btnTextCancel,
                  ]}
                >
                  {btn.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 22, width: '100%', maxWidth: 400, elevation: 6,
  },
  title: { fontSize: 17, fontWeight: '800', color: '#222', marginBottom: 8 },
  message: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 20 },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  btnColumn: { flexDirection: 'column-reverse' },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: '#1565C0' },
  btnText: { fontSize: 14, fontWeight: '700', color: '#fff', textAlign: 'center' },
  btnCancel: { backgroundColor: '#f0f0f0' },
  btnTextCancel: { color: '#555' },
  btnDestructive: { backgroundColor: '#e53e3e' },
  btnTextDestructive: { color: '#fff' },
});

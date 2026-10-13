import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { typedConfirmationMatches } from '../../utils/configValues';

// A real modal window for a change that affects every customer: the confirm button stays off until the exact phrase is typed.
export function TypeToConfirmModal({
  visible, title, message, phrase, confirmLabel, destructive = false, busy = false, onConfirm, onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  phrase: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');

  // start empty every time the window opens
  useEffect(() => {
    if (visible) setTyped('');
  }, [visible]);

  const ready = typedConfirmationMatches(typed, phrase) && !busy;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <Text style={styles.prompt}>
            To confirm, type <Text style={styles.phrase} selectable>{phrase}</Text> below:
          </Text>
          <TextInput
            style={styles.input}
            value={typed}
            onChangeText={setTyped}
            placeholder={phrase}
            placeholderTextColor="#aaa"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={() => ready && onConfirm()}
            accessibilityLabel={`Type ${phrase} to confirm`}
          />
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancel} onPress={onCancel} disabled={busy} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirm, destructive ? styles.confirmRed : styles.confirmBlue, !ready && styles.disabled]}
              onPress={onConfirm}
              disabled={!ready}
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready }}
            >
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmText}>{confirmLabel}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 460, backgroundColor: '#fff', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#CFD8DC' },
  title: { fontSize: 17, fontWeight: '800', color: '#222', marginBottom: 8 },
  message: { fontSize: 13, color: '#444', lineHeight: 19, marginBottom: 12 },
  prompt: { fontSize: 13, color: '#222', marginBottom: 6 },
  phrase: { fontWeight: '800', color: '#C62828' },
  input: { paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  cancel: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, backgroundColor: '#f0f0f0' },
  cancelText: { color: '#555', fontWeight: '700' },
  confirm: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, minWidth: 110, alignItems: 'center' },
  confirmBlue: { backgroundColor: '#1565C0' },
  confirmRed: { backgroundColor: '#C62828' },
  confirmText: { color: '#fff', fontWeight: '800' },
  disabled: { opacity: 0.4 },
});

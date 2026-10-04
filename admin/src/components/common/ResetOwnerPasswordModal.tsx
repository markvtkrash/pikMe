import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, Platform } from 'react-native';
import { Alert } from '../../utils/alert';
import { supabase } from '../../api/supabase';
import { adminResetOwnerPassword, ResetOwnerPasswordResult } from '../../api/restaurantAuth';

export interface ResetOwnerTarget {
  ownerId: string;
  name: string;
  email: string | null;
}

interface Props {
  target: ResetOwnerTarget | null;
  onClose: () => void;
}

async function copyToClipboard(text: string) {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      Alert.alert('Copied', 'Copied to clipboard');
    }
  } catch {
    // Silent fail — the text is still selectable on screen
  }
}

// Confirm -> reset -> show the temporary password once. Used from both the
// Owners page and Menu Management. The password is generated server-side by
// the admin-reset-owner-password edge function; it's only ever held in this
// component's state while the modal is open and is dropped on close.
export function ResetOwnerPasswordModal({ target, onClose }: Props) {
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<ResetOwnerPasswordResult | null>(null);

  useEffect(() => {
    if (!target) {
      setResult(null);
      setWorking(false);
    }
  }, [target]);

  async function handleReset() {
    if (!target) return;
    setWorking(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error('Admin session expired. Please log in again.');
      setResult(await adminResetOwnerPassword({ ownerId: target.ownerId, accessToken }));
    } catch (error: any) {
      console.error('[admin-reset-owner-password] Error:', error?.message);
      Alert.alert('Error', error.message || 'Failed to reset password');
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={() => !working && onClose()}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {!result ? (
            <>
              <Text style={styles.title}>Reset password?</Text>
              <Text style={styles.message}>
                This sets a new temporary password for {target?.name}
                {target?.email ? ` (${target.email})` : ''}. Their current password stops working immediately,
                and they'll be asked to choose a new one the next time they log in.
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={working}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, working && styles.btnDisabled]}
                  onPress={handleReset}
                  disabled={working}
                >
                  {working ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>Reset password</Text>}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Password reset</Text>
              <Text style={styles.message}>
                Share these with the owner. They'll be asked to change the password at their next login.
                This won't be shown again.
              </Text>

              <Text style={styles.label}>Login (email)</Text>
              <Text style={styles.credValue} selectable>{result.email}</Text>

              <Text style={[styles.label, { marginTop: 12 }]}>Temporary password</Text>
              <View style={styles.passwordRow}>
                <Text style={[styles.credValue, styles.passwordValue]} selectable>{result.temporaryPassword}</Text>
                <TouchableOpacity style={styles.copyBtn} onPress={() => copyToClipboard(result.temporaryPassword)}>
                  <Text style={styles.copyText}>Copy</Text>
                </TouchableOpacity>
              </View>

              {!result.mustChangePasswordFlagged && (
                <Text style={styles.warning}>
                  The password was changed, but the owner could not be flagged to change it at next login.
                </Text>
              )}

              <View style={styles.actions}>
                <TouchableOpacity style={styles.primaryBtn} onPress={onClose}>
                  <Text style={styles.primaryText}>Done</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420 },
  title: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  message: { fontSize: 13, color: '#555', lineHeight: 19, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 },
  credValue: { fontSize: 14, fontWeight: '700', color: '#222' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  passwordValue: { flex: 1, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, letterSpacing: 0.5 },
  copyBtn: { backgroundColor: '#1565C0', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  copyText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  warning: { fontSize: 12, color: '#c62828', marginTop: 10, fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { fontSize: 13, fontWeight: '700', color: '#666' },
  primaryBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10, minWidth: 80, alignItems: 'center' },
  primaryText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  btnDisabled: { opacity: 0.5 },
});

import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, Platform, ScrollView,
} from 'react-native';
import { Alert } from '../../utils/alert';
import { supabase } from '../../api/supabase';
import {
  adminResetOwnerPassword, adminGenerateOwnerPassword, ResetOwnerPasswordResult,
} from '../../api/restaurantAuth';
import { passwordChecks, validateTemporaryPassword } from '../../utils/passwordRules';

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

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Admin session expired. Please log in again.');
  return token;
}

// Step 1: the admin sees a suggested strong password in an EDITABLE field (they
// can keep it, change it, or generate another) and confirms. Step 2: the final
// credentials are shown once. Used from the Users page and the Owners page.
// The password is only ever held in this component's state while the modal is
// open and is dropped on close; the edge function enforces the strength rules.
export function ResetOwnerPasswordModal({ target, onClose }: Props) {
  const [password, setPassword] = useState('');
  const [generating, setGenerating] = useState(false);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<ResetOwnerPasswordResult | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  // Guards against a slow suggestion landing after the modal closed or reopened.
  const requestId = useRef(0);

  async function loadSuggestion() {
    const id = ++requestId.current;
    setGenerating(true);
    setGenerateError(null);
    try {
      const suggestion = await adminGenerateOwnerPassword(await getAccessToken());
      if (id === requestId.current) setPassword(suggestion);
    } catch (error: any) {
      if (id === requestId.current) setGenerateError(error?.message || 'Could not generate a password — you can type one instead.');
    } finally {
      if (id === requestId.current) setGenerating(false);
    }
  }

  useEffect(() => {
    if (target) {
      setResult(null);
      setPassword('');
      loadSuggestion();
    } else {
      requestId.current++;
      setResult(null);
      setPassword('');
      setWorking(false);
      setGenerating(false);
      setGenerateError(null);
    }
  }, [target]);

  const problem = validateTemporaryPassword(password);
  const canReset = !working && !generating && problem === null;

  async function handleReset() {
    if (!target || problem !== null) return;
    setWorking(true);
    try {
      const accessToken = await getAccessToken();
      setResult(await adminResetOwnerPassword({ ownerId: target.ownerId, accessToken, temporaryPassword: password }));
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
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.title}>Reset password</Text>
              <Text style={styles.message}>
                Set a temporary password for {target?.name}
                {target?.email ? ` (${target.email})` : ''}. Their current password stops working immediately, and
                they'll be asked to choose a new one the next time they log in.
              </Text>

              <Text style={styles.label}>Temporary password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={generating ? 'Generating…' : 'Enter a password'}
                  placeholderTextColor="#999"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  editable={!working}
                />
                <TouchableOpacity
                  style={[styles.regenBtn, (generating || working) && styles.btnDisabled]}
                  onPress={loadSuggestion}
                  disabled={generating || working}
                >
                  {generating ? <ActivityIndicator size="small" color="#1565C0" /> : <Text style={styles.regenText}>↻ New</Text>}
                </TouchableOpacity>
              </View>
              {!!generateError && <Text style={styles.warning}>{generateError}</Text>}

              {password.length > 0 && (
                <View style={styles.checks}>
                  {passwordChecks(password).map((c) => (
                    <Text key={c.label} style={[styles.check, c.met ? styles.checkMet : styles.checkUnmet]}>
                      {c.met ? '✓' : '○'} {c.label}
                    </Text>
                  ))}
                </View>
              )}

              <View style={styles.actions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={working}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, !canReset && styles.btnDisabled]}
                  onPress={handleReset}
                  disabled={!canReset}
                >
                  {working ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>Reset password</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
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
              <View style={styles.resultRow}>
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
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 440, maxHeight: '90%' },
  title: { fontSize: 16, fontWeight: '800', color: '#222', marginBottom: 8 },
  message: { fontSize: 13, color: '#555', lineHeight: 19, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 },
  credValue: { fontSize: 14, fontWeight: '700', color: '#222' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  passwordInput: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#222', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, letterSpacing: 0.5, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  regenBtn: { borderWidth: 1.5, borderColor: '#1565C0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, minWidth: 64, alignItems: 'center' },
  regenText: { color: '#1565C0', fontWeight: '700', fontSize: 12 },
  checks: { backgroundColor: '#F5F5F5', borderRadius: 8, padding: 10, marginTop: 10, gap: 3 },
  check: { fontSize: 12, fontWeight: '600' },
  checkMet: { color: '#1565C0' },
  checkUnmet: { color: '#999' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  passwordValue: { flex: 1, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, letterSpacing: 0.5 },
  copyBtn: { backgroundColor: '#1565C0', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  copyText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  warning: { fontSize: 12, color: '#c62828', marginTop: 8, fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { fontSize: 13, fontWeight: '700', color: '#666' },
  primaryBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10, minWidth: 80, alignItems: 'center' },
  primaryText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  btnDisabled: { opacity: 0.5 },
});

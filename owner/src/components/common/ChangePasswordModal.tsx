import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { Alert } from '../../utils/alert';
import { supabase, verifyPassword } from '../../api/supabase';
import { useRestaurantOwnerStore } from '../../store/restaurantOwnerStore';

function validatePassword(password: string) {
  return {
    hasMinLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

// Voluntary password change for a logged-in owner (opened from the gear menu
// in OwnerNavHeader). Unlike the forced first-login screen, it asks for the
// CURRENT password first, so someone at an unlocked session can't change it.
export function ChangePasswordModal({ visible, onClose }: Props) {
  const owner = useRestaurantOwnerStore((s) => s.owner);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Fresh form every time it opens; never keep passwords in state once closed.
  useEffect(() => {
    if (!visible) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaving(false);
      setDone(false);
    }
  }, [visible]);

  const strength = validatePassword(newPassword);
  const requirements: { met: boolean; label: string }[] = [
    { met: strength.hasMinLength, label: 'At least 8 characters' },
    { met: strength.hasUppercase, label: 'Uppercase letter (A-Z)' },
    { met: strength.hasLowercase, label: 'Lowercase letter (a-z)' },
    { met: strength.hasNumber, label: 'Number (0-9)' },
    { met: strength.hasSpecialChar, label: 'Special character (!@#$%^&*)' },
  ];

  async function handleSubmit() {
    if (!currentPassword) {
      Alert.alert('Missing info', 'Enter your current password');
      return;
    }
    if (!Object.values(strength).every(Boolean)) {
      Alert.alert('Weak Password', 'Please meet all the password requirements.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    if (newPassword === currentPassword) {
      Alert.alert('Error', 'Your new password must be different from the current one');
      return;
    }

    setSaving(true);
    try {
      let email = owner?.email;
      if (!email) {
        const { data } = await supabase.auth.getUser();
        email = data.user?.email ?? undefined;
      }
      if (!email) throw new Error('Could not determine your login. Please log in again.');

      const currentOk = await verifyPassword(email, currentPassword);
      if (!currentOk) {
        Alert.alert('Incorrect password', 'Your current password is incorrect.');
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      setDone(true);
    } catch (error: any) {
      console.error('[owner-change-password] Error:', error?.message);
      Alert.alert('Error', error.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !saving && onClose()}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {done ? (
            <>
              <Text style={styles.title}>Password changed</Text>
              <Text style={styles.message}>Your password has been updated. Use it the next time you log in.</Text>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.primaryBtn} onPress={onClose}>
                  <Text style={styles.primaryText}>Done</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.title}>Change password</Text>

              <Text style={styles.label}>Current password</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter current password"
                placeholderTextColor="#999"
                secureTextEntry
                value={currentPassword}
                onChangeText={setCurrentPassword}
                editable={!saving}
                autoCapitalize="none"
              />

              <Text style={styles.label}>New password</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter new password"
                placeholderTextColor="#999"
                secureTextEntry
                value={newPassword}
                onChangeText={setNewPassword}
                editable={!saving}
                autoCapitalize="none"
              />

              <Text style={styles.label}>Confirm new password</Text>
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor="#999"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                editable={!saving}
                autoCapitalize="none"
              />

              {!!newPassword && (
                <View style={styles.reqBox}>
                  {requirements.map((r) => (
                    <Text key={r.label} style={[styles.req, r.met ? styles.reqMet : styles.reqUnmet]}>
                      {r.met ? '✓' : '○'} {r.label}
                    </Text>
                  ))}
                </View>
              )}

              {!!newPassword && !!confirmPassword && newPassword !== confirmPassword && (
                <Text style={styles.errorText}>❌ Passwords do not match</Text>
              )}

              <View style={styles.actions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, saving && styles.btnDisabled]}
                  onPress={handleSubmit}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: '800', color: '#222', marginBottom: 12 },
  message: { fontSize: 13, color: '#555', lineHeight: 19, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '700', color: '#333', marginBottom: 6, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 15, marginBottom: 6, color: '#222',
  },
  reqBox: { backgroundColor: '#F5F5F5', borderRadius: 10, padding: 12, marginTop: 6, gap: 4 },
  req: { fontSize: 12, fontWeight: '600' },
  reqMet: { color: '#1565C0' },
  reqUnmet: { color: '#999' },
  errorText: { color: '#e53e3e', fontSize: 13, fontWeight: '600', marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { fontSize: 13, fontWeight: '700', color: '#666' },
  primaryBtn: { backgroundColor: '#1565C0', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, minWidth: 80, alignItems: 'center' },
  primaryText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  btnDisabled: { opacity: 0.5 },
});

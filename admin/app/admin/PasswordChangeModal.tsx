import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { supabase } from '../../src/api/supabase';

interface Props {
  visible: boolean;
  userEmail: string;
  onClose: () => void;
}

export function PasswordChangeModal({ visible, userEmail, onClose }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  function validatePassword(password: string) {
    return {
      hasMinLength: password.length >= 8,
      hasUppercase: /[A-Z]/.test(password),
      hasLowercase: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    };
  }

  async function handleUpdatePassword() {
    if (!currentPassword.trim()) {
      Alert.alert('Error', 'Please enter your current password');
      return;
    }
    if (!newPassword.trim()) {
      Alert.alert('Error', 'Please enter a new password');
      return;
    }
    if (!confirmPassword.trim()) {
      Alert.alert('Error', 'Please confirm your new password');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New password and confirmation do not match');
      return;
    }
    if (newPassword === currentPassword) {
      Alert.alert('Error', 'New password cannot be the same as current password');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }

    const strength = validatePassword(newPassword);
    const missingRequirements = [];
    if (!strength.hasUppercase) missingRequirements.push('uppercase letter');
    if (!strength.hasLowercase) missingRequirements.push('lowercase letter');
    if (!strength.hasNumber) missingRequirements.push('number');
    if (!strength.hasSpecialChar) missingRequirements.push('special character');

    if (missingRequirements.length > 0) {
      Alert.alert('Weak Password', `Password must contain at least one:\n• ${missingRequirements.join('\n• ')}`);
      return;
    }

    setChangingPassword(true);
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/admin-change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          currentPassword: currentPassword,
          newPassword: newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to change password');
      }

      Alert.alert('Success', 'Password changed successfully! ✅');
      onClose();
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('[admin-password-modal] Error:', error);
      Alert.alert('Error', error.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  }

  if (!visible) return null;

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}><View style={styles.container}><View style={styles.content}><Text style={styles.title}>🔐 Change Password</Text><Text style={styles.label}>Current Password</Text><TextInput style={styles.input} placeholder="Enter current password" placeholderTextColor="#999" secureTextEntry value={currentPassword} onChangeText={setCurrentPassword} editable={!changingPassword} /><Text style={styles.label}>New Password</Text><TextInput style={styles.input} placeholder="Enter new password (min 6 chars)" placeholderTextColor="#999" secureTextEntry value={newPassword} onChangeText={setNewPassword} editable={!changingPassword} /><Text style={styles.label}>Confirm Password</Text><TextInput style={styles.input} placeholder="Confirm new password" placeholderTextColor="#999" secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} editable={!changingPassword} />{!!newPassword && <View style={styles.strengthContainer}><Text style={styles.strengthLabel}>Password Requirements:</Text><View style={styles.requirementsList}><Text style={[styles.requirement, validatePassword(newPassword).hasMinLength ? styles.requirementMet : styles.requirementUnmet]}>{validatePassword(newPassword).hasMinLength ? '✓' : '○'} At least 8 characters</Text><Text style={[styles.requirement, validatePassword(newPassword).hasUppercase ? styles.requirementMet : styles.requirementUnmet]}>{validatePassword(newPassword).hasUppercase ? '✓' : '○'} Uppercase letter (A-Z)</Text><Text style={[styles.requirement, validatePassword(newPassword).hasLowercase ? styles.requirementMet : styles.requirementUnmet]}>{validatePassword(newPassword).hasLowercase ? '✓' : '○'} Lowercase letter (a-z)</Text><Text style={[styles.requirement, validatePassword(newPassword).hasNumber ? styles.requirementMet : styles.requirementUnmet]}>{validatePassword(newPassword).hasNumber ? '✓' : '○'} Number (0-9)</Text><Text style={[styles.requirement, validatePassword(newPassword).hasSpecialChar ? styles.requirementMet : styles.requirementUnmet]}>{validatePassword(newPassword).hasSpecialChar ? '✓' : '○'} Special character (!@#$%^&*)</Text></View></View>}{!!newPassword && !!confirmPassword && newPassword !== confirmPassword && <Text style={styles.errorMessage}>❌ Passwords do not match</Text>}{!!newPassword && newPassword === currentPassword && <Text style={styles.errorMessage}>❌ Cannot reuse the same password</Text>}<View style={styles.buttonRow}><TouchableOpacity style={styles.buttonCancel} onPress={onClose} disabled={changingPassword}><Text style={styles.buttonCancelText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={[styles.buttonSave, changingPassword && styles.buttonDisabled]} onPress={handleUpdatePassword} disabled={changingPassword}>{changingPassword ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.buttonSaveText}>Update Password</Text>}</TouchableOpacity></View></View></View></KeyboardAvoidingView></Modal>;

}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  content: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 },
  title: { fontSize: 20, fontWeight: '800', color: '#222', marginBottom: 20, textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '700', color: '#333', marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#222', borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 8 },
  strengthContainer: { backgroundColor: '#F5F5F5', borderRadius: 10, padding: 12, marginBottom: 12, marginTop: 8 },
  strengthLabel: { fontSize: 12, fontWeight: '700', color: '#333', marginBottom: 8 },
  requirementsList: { gap: 6 },
  requirement: { fontSize: 11, fontWeight: '600', marginLeft: 4 },
  requirementMet: { color: '#2e7d32' },
  requirementUnmet: { color: '#999' },
  errorMessage: { fontSize: 12, fontWeight: '600', color: '#e53e3e', marginBottom: 12, marginTop: 4 },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  buttonCancel: { flex: 1, backgroundColor: '#f0f0f0', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  buttonCancelText: { fontSize: 14, fontWeight: '700', color: '#666' },
  buttonSave: { flex: 1, backgroundColor: '#1565C0', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  buttonSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  buttonDisabled: { opacity: 0.6 },
});

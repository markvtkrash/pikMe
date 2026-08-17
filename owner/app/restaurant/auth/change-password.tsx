import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/api/supabase';
import { getRestaurantForOwner } from '../../../src/api/restaurantAuth';
import { useRestaurantOwnerStore } from '../../../src/store/restaurantOwnerStore';

function validatePassword(password: string) {
  return {
    hasMinLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };
}

export default function RestaurantChangePasswordScreen() {
  const router = useRouter();
  const { owner, setRestaurant } = useRestaurantOwnerStore();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    const strength = validatePassword(newPassword);
    if (!strength.hasMinLength || !strength.hasUppercase || !strength.hasLowercase ||
        !strength.hasNumber || !strength.hasSpecialChar) {
      Alert.alert('Weak Password', 'Please meet all the password requirements.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setSaving(true);
    try {
      // Owner is authenticated from login, so the session is live
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      // Resolve owner id (store, with auth fallback after a refresh)
      let ownerId = owner?.id;
      if (!ownerId) {
        const { data } = await supabase.auth.getUser();
        ownerId = data.user?.id;
      }

      // Clear the forced-change flag (RLS allows owners to update their own record)
      if (ownerId) {
        const { error: flagError } = await supabase
          .from('restaurant_owners')
          .update({ must_change_password: false, updated_at: new Date().toISOString() })
          .eq('id', ownerId);
        if (flagError) {
          console.error('[restaurant-change-password] Failed to clear flag:', flagError);
        }
      }

      // Continue into the app
      const restaurant = await getRestaurantForOwner();
      if (restaurant) {
        setRestaurant(restaurant);
        router.replace('/restaurant/dashboard');
      } else {
        router.replace('/restaurant/claim');
      }
    } catch (error: any) {
      console.error('[restaurant-change-password] Error:', error);
      Alert.alert('Error', error.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  const strength = validatePassword(newPassword);
  const requirements: { met: boolean; label: string }[] = [
    { met: strength.hasMinLength, label: 'At least 8 characters' },
    { met: strength.hasUppercase, label: 'Uppercase letter (A-Z)' },
    { met: strength.hasLowercase, label: 'Lowercase letter (a-z)' },
    { met: strength.hasNumber, label: 'Number (0-9)' },
    { met: strength.hasSpecialChar, label: 'Special character (!@#$%^&*)' },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner}>
        <Text style={styles.title}>🔐 Set a New Password</Text>
        <Text style={styles.subtitle}>
          Your account uses a temporary password. Please choose a new one to continue.
        </Text>

        <Text style={styles.label}>New Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter new password"
          placeholderTextColor="#999"
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
          editable={!saving}
        />

        <Text style={styles.label}>Confirm Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Confirm new password"
          placeholderTextColor="#999"
          secureTextEntry
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          editable={!saving}
        />

        {!!newPassword && (
          <View style={styles.reqBox}>
            <Text style={styles.reqTitle}>Password Requirements:</Text>
            {requirements.map((r) => (
              <Text
                key={r.label}
                style={[styles.req, r.met ? styles.reqMet : styles.reqUnmet]}
              >
                {r.met ? '✓' : '○'} {r.label}
              </Text>
            ))}
          </View>
        )}

        {!!newPassword && !!confirmPassword && newPassword !== confirmPassword && (
          <Text style={styles.errorText}>❌ Passwords do not match</Text>
        )}

        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Save & Continue</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 8, color: '#222' },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 28, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '700', color: '#333', marginBottom: 6, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 16,
    paddingVertical: 12, fontSize: 16, marginBottom: 8, color: '#222',
  },
  reqBox: { backgroundColor: '#F5F5F5', borderRadius: 10, padding: 14, marginTop: 8, marginBottom: 8, gap: 6 },
  reqTitle: { fontSize: 12, fontWeight: '700', color: '#333', marginBottom: 4 },
  req: { fontSize: 12, fontWeight: '600' },
  reqMet: { color: '#2e7d32' },
  reqUnmet: { color: '#999' },
  errorText: { color: '#e53e3e', fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 4 },
  button: {
    backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 14,
    alignItems: 'center', marginTop: 16, minHeight: 50, justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

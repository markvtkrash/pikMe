import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { supabase } from '../../src/api/supabase';
import { LegalDocumentModal, type DocumentType } from '../../src/components/common/LegalDocumentModal';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [agreedToLegal, setAgreedToLegal] = useState(false);
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [currentDocument, setCurrentDocument] = useState<DocumentType>('privacy_policy');

  async function handleSubmit() {
    setError('');
    setSuccessMsg('');

    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    if (mode === 'sign-up' && !agreedToLegal) {
      setError('You must agree to the Terms of Service and Privacy Policy.');
      return;
    }

    setLoading(true);
    try {
      console.log('[PikMe auth] Attempting', mode, 'for:', email.trim());
      if (mode === 'sign-in') {
        console.log('[PikMe auth] Calling signInWithPassword...');
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        console.log('[PikMe auth] signInWithPassword response:', { hasData: !!data, hasError: !!error, error: error?.message });
        if (error) throw error;
        console.log('[PikMe auth] Sign in successful');
        // Auth state change in _layout.tsx handles navigation
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;

        // Record user agreements after successful account creation
        if (data.user) {
          try {
            await supabase.rpc('record_user_agreement', {
              p_agreement_type: 'privacy_policy',
              p_version: '1.0',
            });
            await supabase.rpc('record_user_agreement', {
              p_agreement_type: 'terms_of_service',
              p_version: '1.0',
            });
            console.log('[PikMe auth] Agreements recorded for user', data.user.id);
          } catch (agreementErr) {
            console.warn('[PikMe auth] Failed to record agreements:', agreementErr);
            // Don't fail signup if agreement recording fails
          }
        }

        if (data.session) {
          // Auto-confirmed — auth state change handles navigation
        } else {
          setSuccessMsg('Account created! Check your email for a confirmation link, or sign in if auto-confirm is enabled.');
        }
      }
    } catch (err: any) {
      console.error('[PikMe auth error]', {
        message: err?.message,
        status: err?.status,
        code: err?.code,
        details: JSON.stringify(err, null, 2),
      });
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      console.log('[PikMe auth] finally block, loading set to false');
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.logo}>🍽️ PikMe</Text>
        <Text style={styles.subtitle}>
          {mode === 'sign-in' ? 'Sign in to your account' : 'Create an account'}
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#999"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={(t) => { setEmail(t); setError(''); }}
        />
        <View style={styles.passwordContainer}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Password (min 6 characters)"
            placeholderTextColor="#999"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            value={password}
            onChangeText={(t) => { setPassword(t); setError(''); }}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword((prev) => !prev)}
            hitSlop={10}
          >
            <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {successMsg ? <Text style={styles.successText}>{successMsg}</Text> : null}

        {/* Legal Agreement Checkbox (Sign-Up Only) */}
        {mode === 'sign-up' && (
          <View style={styles.legalContainer}>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setAgreedToLegal(!agreedToLegal)}
            >
              <View style={[styles.checkbox, agreedToLegal && styles.checkboxChecked]}>
                {agreedToLegal && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.legalText}>
                  I agree to the{' '}
                  <Text
                    style={styles.link}
                    onPress={() => { setCurrentDocument('privacy_policy'); setShowLegalModal(true); }}
                  >
                    Privacy Policy
                  </Text>
                  {' '}and{' '}
                  <Text
                    style={styles.link}
                    onPress={() => { setCurrentDocument('terms_of_service'); setShowLegalModal(true); }}
                  >
                    Terms of Service
                  </Text>
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>
                {mode === 'sign-in' ? 'Sign In' : 'Create Account'}
              </Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switchMode}
          onPress={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(''); setSuccessMsg(''); setAgreedToLegal(false); }}
        >
          <Text style={styles.switchText}>
            {mode === 'sign-in'
              ? "Don't have an account? Sign up"
              : 'Already have an account? Sign in'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Legal Document Modal */}
      <LegalDocumentModal
        visible={showLegalModal}
        documentType={currentDocument}
        onClose={() => setShowLegalModal(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  logo: { fontSize: 40, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 32 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
    color: '#222',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginBottom: 12,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#222',
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  eyeIcon: {
    fontSize: 18,
  },
  errorText: {
    color: '#e53e3e',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
  successText: {
    color: '#2e7d32',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  switchMode: { marginTop: 20, alignItems: 'center' },
  switchText: { color: '#4CAF50', fontSize: 14 },

  legalContainer: { marginBottom: 16, marginTop: 8 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#ddd',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  legalText: { fontSize: 12, color: '#555', lineHeight: 18 },
  link: { color: '#4CAF50', fontWeight: '600', textDecorationLine: 'underline' },
});

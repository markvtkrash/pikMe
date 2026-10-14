import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import { isValidEmail } from '../../src/utils/passwordReset';
import { LegalDocumentModal, type DocumentType } from '../../src/components/common/LegalDocumentModal';

// A password box with its own show / hide eye.
function PasswordField({
  value, onChangeText, placeholder, onSubmit,
}: { value: string; onChangeText: (t: string) => void; placeholder: string; onSubmit: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <View style={styles.passwordContainer}>
      <TextInput
        style={styles.passwordInput}
        placeholder={placeholder}
        placeholderTextColor="#999"
        secureTextEntry={!show}
        autoCapitalize="none"
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
      />
      <TouchableOpacity style={styles.eyeButton} onPress={() => setShow((prev) => !prev)} hitSlop={10}>
        <Text style={styles.eyeIcon}>{show ? '🙈' : '👁️'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// Sign in and register are on the same page as two separate cards with their own borders: side by side on a wide screen, stacked on a phone. The
// sizes are kept small so both fit on one screen without scrolling.
export default function SignInScreen() {
  const router = useRouter();
  const wide = useWindowDimensions().width >= 720;

  // sign in
  const [inEmail, setInEmail] = useState('');
  const [inPassword, setInPassword] = useState('');
  const [inLoading, setInLoading] = useState(false);
  const [inError, setInError] = useState('');

  // register
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState('');
  const [agreedToLegal, setAgreedToLegal] = useState(false);

  const [showLegalModal, setShowLegalModal] = useState(false);
  const [currentDocument, setCurrentDocument] = useState<DocumentType>('privacy_policy');

  async function handleSignIn() {
    setInError('');
    if (!inEmail.trim() || !inPassword) {
      setInError('Please enter your email and password.');
      return;
    }
    if (!isValidEmail(inEmail)) {
      setInError('Please enter a valid email address, like name@example.com.');
      return;
    }

    setInLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: inEmail.trim(), password: inPassword });
      if (error) throw error;
      // Auth state change in _layout.tsx handles navigation
    } catch (err: any) {
      console.error('[PikMe auth error]', { message: err?.message, status: err?.status, code: err?.code });
      setInError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setInLoading(false);
    }
  }

  async function handleRegister() {
    setRegError('');
    setRegSuccess('');
    if (!regEmail.trim() || !regPassword) {
      setRegError('Please enter your email and a password.');
      return;
    }
    if (!isValidEmail(regEmail)) {
      setRegError('Please enter a valid email address, like name@example.com.');
      return;
    }
    if (!agreedToLegal) {
      setRegError('You must agree to the Terms of Service, Privacy Policy and Food Disclaimer.');
      return;
    }

    setRegLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: regEmail.trim(), password: regPassword });
      if (error) throw error;

      // Record user agreements after successful account creation
      if (data.user) {
        try {
          await supabase.rpc('record_user_agreement', { p_agreement_type: 'privacy_policy', p_version: '1.0' });
          await supabase.rpc('record_user_agreement', { p_agreement_type: 'terms_of_service', p_version: '1.0' });
          // The food disclaimer used to be acknowledged at the end of the food-preferences setup, which is optional now.
          await supabase.rpc('record_user_agreement', { p_agreement_type: 'food_disclaimer', p_version: '1.0' });
        } catch (agreementErr) {
          console.warn('[PikMe auth] Failed to record agreements:', agreementErr);
          // Don't fail signup if agreement recording fails
        }
      }

      if (!data.session) {
        setRegSuccess('Account created! Check your email for a confirmation link, or sign in if auto-confirm is enabled.');
      }
      // with a session, the auth state change handles navigation
    } catch (err: any) {
      console.error('[PikMe auth error]', { message: err?.message, status: err?.status, code: err?.code });
      setRegError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={[styles.cards, wide && styles.cardsWide]}>
          {/* Sign in card */}
          <View style={[styles.card, styles.signInCard]}>
            <Text style={[styles.cardTitle, styles.signInTitle]}>Sign in to your account</Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#999"
              autoCapitalize="none"
              keyboardType="email-address"
              value={inEmail}
              onChangeText={(t) => { setInEmail(t); setInError(''); }}
            />
            <PasswordField
              value={inPassword}
              onChangeText={(t) => { setInPassword(t); setInError(''); }}
              placeholder="Password"
              onSubmit={handleSignIn}
            />
            {inError ? <Text style={styles.errorText}>{inError}</Text> : null}
            <TouchableOpacity style={[styles.button, inLoading && styles.buttonDisabled]} onPress={handleSignIn} disabled={inLoading}>
              {inLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.forgot} onPress={() => router.push('/(auth)/forgot-password')} accessibilityRole="button">
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          {/* Register card */}
          <View style={[styles.card, styles.registerCard]}>
            <Text style={[styles.cardTitle, styles.registerTitle]}>New here? Create an account</Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#999"
              autoCapitalize="none"
              keyboardType="email-address"
              value={regEmail}
              onChangeText={(t) => { setRegEmail(t); setRegError(''); }}
            />
            <Text style={styles.emailNote}>Email is all we need. It's used to reset your password.</Text>
            <PasswordField
              value={regPassword}
              onChangeText={(t) => { setRegPassword(t); setRegError(''); }}
              placeholder="Password (min 6 characters)"
              onSubmit={handleRegister}
            />
            {regError ? <Text style={styles.errorText}>{regError}</Text> : null}
            {regSuccess ? <Text style={styles.successText}>{regSuccess}</Text> : null}

            <TouchableOpacity style={styles.checkboxRow} onPress={() => setAgreedToLegal(!agreedToLegal)}>
              <View style={[styles.checkbox, agreedToLegal && styles.checkboxChecked]}>
                {agreedToLegal && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.legalText}>
                  I agree to the{' '}
                  <Text style={styles.link} onPress={() => { setCurrentDocument('privacy_policy'); setShowLegalModal(true); }}>Privacy Policy</Text>
                  {', '}
                  <Text style={styles.link} onPress={() => { setCurrentDocument('terms_of_service'); setShowLegalModal(true); }}>Terms of Service</Text>
                  {' '}and{' '}
                  <Text style={styles.link} onPress={() => { setCurrentDocument('food_disclaimer'); setShowLegalModal(true); }}>Food Disclaimer</Text>
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, styles.registerButton, regLoading && styles.buttonDisabled]} onPress={handleRegister} disabled={regLoading}>
              {regLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create Account</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Legal Document Modal */}
      <LegalDocumentModal visible={showLegalModal} documentType={currentDocument} onClose={() => setShowLegalModal(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8FB' },
  // the top padding leaves room for the logo and name that float at the top left of every screen
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12 },
  cards: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: 12 },
  cardsWide: { maxWidth: 900, flexDirection: 'row', alignItems: 'stretch', gap: 20 },

  // two cards with their own, different borders
  card: { flex: 1, backgroundColor: '#fff', borderRadius: 16, borderWidth: 2, padding: 14 },
  signInCard: { borderColor: '#1565C0' },
  registerCard: { borderColor: '#2E7D32', backgroundColor: '#FAFFFA' },
  cardTitle: { fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  signInTitle: { color: '#1565C0' },
  registerTitle: { color: '#1B5E20' },

  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    marginBottom: 8,
    color: '#222',
    backgroundColor: '#fff',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  passwordInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, color: '#222' },
  eyeButton: { paddingHorizontal: 12, paddingVertical: 9 },
  eyeIcon: { fontSize: 17 },
  errorText: { color: '#e53e3e', fontSize: 13, marginBottom: 6, textAlign: 'center' },
  successText: { color: '#1565C0', fontSize: 13, marginBottom: 6, textAlign: 'center', lineHeight: 18 },
  button: {
    backgroundColor: '#1565C0',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 4,
    minHeight: 42,
    justifyContent: 'center',
  },
  registerButton: { backgroundColor: '#2E7D32' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  forgot: { marginTop: 10, alignItems: 'center' },
  forgotText: { color: '#1565C0', fontSize: 14, fontWeight: '800' },
  emailNote: { fontSize: 12, fontWeight: '600', color: '#7A4A00', backgroundColor: '#FFF3E0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, lineHeight: 16, marginBottom: 8 },

  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 2, marginBottom: 8 },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderColor: '#bbb',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    backgroundColor: '#fff',
  },
  checkboxChecked: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  checkmark: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  legalText: { fontSize: 11.5, color: '#555', lineHeight: 16 },
  link: { color: '#1565C0', fontWeight: '600', textDecorationLine: 'underline' },
});

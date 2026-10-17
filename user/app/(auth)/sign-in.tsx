import { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import { Alert } from '../../src/utils/alert';
import {
  AGREEMENT_BUTTON, AGREEMENT_DOCUMENTS, AGREEMENT_INTRO, AGREEMENT_TITLE, AGREEMENT_VERSION, CHECK_EMAIL_MESSAGE, CREATE_NEEDS_TITLE, signInErrorMessage,
  validateRegister, validateSignIn, type FormField, type FormProblem,
} from '../../src/utils/authForm';
import { LegalDocumentModal, type DocumentType } from '../../src/components/common/LegalDocumentModal';
import { useThemedStyles } from '../../src/theme/useTheme';
import { trackEvent } from '../../src/api/analytics';

// A password box with its own show / hide eye.
function PasswordField({
  value, onChangeText, placeholder, onSubmit, inputRef, invalid,
}: {
  value: string; onChangeText: (t: string) => void; placeholder: string; onSubmit: () => void;
  inputRef?: React.Ref<TextInput>; invalid?: boolean;
}) {
  const styles = useThemedStyles(baseStyles);
  const [show, setShow] = useState(false);
  return (
    <View style={[styles.passwordContainer, invalid && styles.fieldInvalid]}>
      <TextInput
        ref={inputRef}
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

// Sign in and create an account share one form: the same email and password, with a Sign In button and a Create Account button. Create Account
// first checks the email and password, then shows the agreement as a popup; the account is made when the person agrees there. The checks and the
// wording live in utils/authForm (tested there).
export default function SignInScreen() {
  const styles = useThemedStyles(baseStyles);
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showAgreement, setShowAgreement] = useState(false);
  const [busy, setBusy] = useState<'signIn' | 'register' | null>(null);
  const [error, setError] = useState('');
  // the box a problem is about: the cursor goes there and it gets a red ring until the person types again
  const [errorField, setErrorField] = useState<FormField | null>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const [success, setSuccess] = useState('');

  const [showLegalModal, setShowLegalModal] = useState(false);
  const [currentDocument, setCurrentDocument] = useState<DocumentType>('privacy_policy');

  function clearMessages() {
    setError('');
    setSuccess('');
    setErrorField(null);
  }

  // show a form problem, and put the cursor in the box it is about
  function showProblem(problem: FormProblem) {
    setError(problem.message);
    setErrorField(problem.field);
    (problem.field === 'email' ? emailRef : passwordRef).current?.focus();
  }

  async function handleSignIn() {
    clearMessages();
    const problem = validateSignIn(email, password);
    if (problem) {
      showProblem(problem);
      return;
    }

    setBusy('signIn');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) throw signInError;
      // Auth state change in _layout.tsx handles navigation
    } catch (err: any) {
      console.error('[PikMe auth error]', { message: err?.message, status: err?.status, code: err?.code });
      setError(signInErrorMessage(err?.message));
    } finally {
      setBusy(null);
    }
  }

  // Create Account: check the form, then ask for the agreement in a popup.
  function handleRegister() {
    clearMessages();
    const problem = validateRegister(email, password);
    if (problem) {
      if (problem.missing) {
        // something was left empty: a popup says what is needed, and the cursor goes to that box when it is closed
        setErrorField(problem.field);
        Alert.alert(CREATE_NEEDS_TITLE, undefined, [{ text: 'OK', onPress: () => (problem.field === 'email' ? emailRef : passwordRef).current?.focus() }]);
      } else {
        showProblem(problem);
      }
      return;
    }
    setShowAgreement(true);
  }

  // The person agreed in the popup: make the account.
  async function confirmRegister() {
    setShowAgreement(false);
    setBusy('register');
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
      if (signUpError) throw signUpError;
      trackEvent('sign_up');

      // Record user agreements after successful account creation
      if (data.user) {
        try {
          // privacy policy, terms of service and the food disclaimer (it used to be acknowledged at the end of the optional food-preferences setup)
          for (const doc of AGREEMENT_DOCUMENTS) {
            await supabase.rpc('record_user_agreement', { p_agreement_type: doc.type, p_version: AGREEMENT_VERSION });
          }
        } catch (agreementErr) {
          console.warn('[PikMe auth] Failed to record agreements:', agreementErr);
          // Don't fail signup if agreement recording fails
        }
      }

      if (!data.session) setSuccess(CHECK_EMAIL_MESSAGE);
      // with a session, the auth state change handles navigation
    } catch (err: any) {
      console.error('[PikMe auth error]', { message: err?.message, status: err?.status, code: err?.code });
      setError(err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in or create an account</Text>
          <TextInput
            ref={emailRef}
            style={[styles.input, errorField === 'email' && styles.fieldInvalid]}
            placeholder="Email"
            placeholderTextColor="#999"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={(t) => { setEmail(t); clearMessages(); }}
          />
          <PasswordField
            value={password}
            onChangeText={(t) => { setPassword(t); clearMessages(); }}
            placeholder="Password"
            onSubmit={handleSignIn}
            inputRef={passwordRef}
            invalid={errorField === 'password'}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {success ? <Text style={styles.successText}>{success}</Text> : null}

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.button, styles.signInButton, busy !== null && styles.buttonDisabled]}
              onPress={handleSignIn}
              disabled={busy !== null}
              accessibilityRole="button"
            >
              {busy === 'signIn' ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
            </TouchableOpacity>
            {/* the note belongs to Create Account only, so it is written on that button, under its name */}
            <TouchableOpacity
              style={[styles.button, styles.registerButton, busy !== null && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel="Create Account. Just email and password. Your email is only for password resets."
            >
              {busy === 'register' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.buttonText}>Create Account</Text>
                  <Text style={styles.buttonSub}>Just email and password.</Text>
                  <Text style={styles.buttonSub}>Your email is only for password resets.</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.forgot} onPress={() => router.push('/(auth)/forgot-password')} accessibilityRole="button">
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* The agreement, asked for after Create Account is pressed. It is a layer on this screen (not a second native window) so the document
          viewer below can open on top of it. A tap outside it, or Cancel, goes back to the form without making an account. */}
      {showAgreement && (
        <View style={styles.agreementLayer}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowAgreement(false)} accessibilityLabel="Close" />
          <View style={styles.agreementCard}>
            <Text style={styles.agreementTitle}>{AGREEMENT_TITLE}</Text>
            <Text style={styles.agreementIntro}>{AGREEMENT_INTRO}</Text>
            {AGREEMENT_DOCUMENTS.map((doc) => (
              <TouchableOpacity
                key={doc.type}
                style={styles.agreementRow}
                onPress={() => { setCurrentDocument(doc.type); setShowLegalModal(true); }}
                accessibilityRole="button"
              >
                <Text style={styles.agreementRowText}>{doc.label}</Text>
                <Text style={styles.agreementRowGo}>Read ›</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.button, styles.registerButton, styles.agreementButton]} onPress={confirmRegister} accessibilityRole="button">
              <Text style={styles.buttonText}>{AGREEMENT_BUTTON}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.agreementCancel} onPress={() => setShowAgreement(false)} accessibilityRole="button">
              <Text style={styles.agreementCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Legal Document Modal */}
      <LegalDocumentModal visible={showLegalModal} documentType={currentDocument} onClose={() => setShowLegalModal(false)} />
    </KeyboardAvoidingView>
  );
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8FB' },
  // the top padding leaves room for the logo and name that float at the top left of every screen
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12 },

  card: { width: '100%', maxWidth: 460, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 16, borderWidth: 2, borderColor: '#1565C0', padding: 18 },
  cardTitle: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 14, color: '#1565C0' },

  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    marginBottom: 8,
    color: '#222',
    backgroundColor: '#fff',
  },
  // the box a problem is about
  fieldInvalid: { borderColor: '#e53e3e', borderWidth: 2 },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  passwordInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, color: '#222' },
  eyeButton: { paddingHorizontal: 12, paddingVertical: 9 },
  eyeIcon: { fontSize: 20 },
  errorText: { color: '#e53e3e', fontSize: 15, marginBottom: 8, textAlign: 'center', lineHeight: 21 },
  successText: { color: '#1565C0', fontSize: 15, marginBottom: 8, textAlign: 'center', lineHeight: 21 },

  // the agreement popup
  agreementLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 20 },
  agreementCard: { backgroundColor: '#fff', borderRadius: 16, padding: 18, width: '100%', maxWidth: 380, borderWidth: 2, borderColor: '#2E7D32' },
  agreementTitle: { fontSize: 22, fontWeight: '800', color: '#1B5E20', marginBottom: 6 },
  agreementIntro: { fontSize: 16, color: '#444', marginBottom: 14 },
  agreementRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: '#1565C0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 8, backgroundColor: '#F4F9FF',
  },
  agreementRowText: { fontSize: 18, fontWeight: '700', color: '#0D47A1' },
  agreementRowGo: { fontSize: 16, fontWeight: '800', color: '#1565C0' },
  agreementButton: { flex: 0, marginTop: 8 },
  agreementCancel: { alignItems: 'center', paddingVertical: 12 },
  agreementCancelText: { fontSize: 17, fontWeight: '700', color: '#666' },

  // Sign In, then the note and Create Account together: stacked, so each button is full width and the note fits on one or two lines
  buttons: { gap: 8 },
  button: { borderRadius: 10, paddingVertical: 8, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  signInButton: { backgroundColor: '#1565C0' },
  registerButton: { backgroundColor: '#2E7D32' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  // the small line under Create Account
  buttonSub: { color: '#fff', fontSize: 13.5, fontWeight: '600', textAlign: 'center', marginTop: 2, paddingHorizontal: 8, lineHeight: 18 },
  forgot: { marginTop: 12, alignItems: 'center' },
  forgotText: { color: '#1565C0', fontSize: 17, fontWeight: '800' },
});

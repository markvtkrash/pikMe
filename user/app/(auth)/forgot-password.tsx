import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/api/supabase';
import { requestPasswordResetCode, verifyRecoveryCode, setNewPassword } from '../../src/api/passwordReset';
import {
  isValidEmail, normalizeResetCode, isCompleteResetCode, resendSecondsLeft, newPasswordProblem,
  RESET_REQUESTED_MESSAGE, MIN_PASSWORD_LENGTH,
} from '../../src/utils/passwordReset';
import { BRAND_NAME } from '../../src/constants/brandTheme';

// Forgot password: (1) enter the email, (2) enter the 6-digit code from the email plus a new password. The code signs the person in
// briefly so the new password can be saved; the route guard in app/_layout.tsx leaves this screen alone while that happens.
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (sentAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sentAt]);

  const secondsLeft = resendSecondsLeft(sentAt, now);

  async function sendCode(isResend: boolean) {
    setError('');
    setInfo('');
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      const result = await requestPasswordResetCode(email);
      if (result.error) {
        setError(result.error);
        return;
      }
      const sentTime = Date.now();
      setSentAt(sentTime);
      setNow(sentTime);
      setInfo(RESET_REQUESTED_MESSAGE);
      if (!isResend) setStep('code');
    } finally {
      setBusy(false);
    }
  }

  async function submitNewPassword() {
    setError('');
    if (!isCompleteResetCode(code)) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    const problem = newPasswordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const verified = await verifyRecoveryCode(email, code);
      if (verified.error) {
        setError(verified.error);
        return;
      }
      const saved = await setNewPassword(password);
      if (saved.error) {
        // The code is spent once it has been verified, so start over rather than leave a half-signed-in session behind.
        await supabase.auth.signOut();
        setError(`${saved.error} Request a new code to try again.`);
        setCode('');
        return;
      }
      // Signed in with the new password already; the route guard in _layout.tsx takes it from here.
      router.replace('/(main)/(tabs)');
    } finally {
      setBusy(false);
    }
  }

  function changeEmail() {
    setStep('email');
    setCode('');
    setPassword('');
    setConfirm('');
    setError('');
    setInfo('');
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>{BRAND_NAME}</Text>
        <Text style={styles.subtitle}>
          {step === 'email' ? 'Reset your password' : 'Enter the code we emailed you'}
        </Text>

        {step === 'email' ? (
          <>
            <Text style={styles.help}>Enter your account email and we will send you a 6-digit code.</Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={(t) => { setEmail(t); setError(''); }}
              onSubmitEditing={() => sendCode(false)}
              editable={!busy}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TouchableOpacity style={[styles.button, busy && styles.buttonDisabled]} onPress={() => sendCode(false)} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send Code</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            {info ? <Text style={styles.successText}>{info}</Text> : null}
            <Text style={styles.emailLine}>{email.trim()}</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="6-digit code"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={12}
              value={code}
              onChangeText={(t) => { setCode(normalizeResetCode(t)); setError(''); }}
              editable={!busy}
            />
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`}
                placeholderTextColor="#999"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                value={password}
                onChangeText={(t) => { setPassword(t); setError(''); }}
                editable={!busy}
              />
              <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword((p) => !p)} hitSlop={10}>
                <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              placeholderTextColor="#999"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              value={confirm}
              onChangeText={(t) => { setConfirm(t); setError(''); }}
              onSubmitEditing={submitNewPassword}
              editable={!busy}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TouchableOpacity style={[styles.button, busy && styles.buttonDisabled]} onPress={submitNewPassword} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Reset Password</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkRow} onPress={() => sendCode(true)} disabled={busy || secondsLeft > 0}>
              <Text style={[styles.linkText, (busy || secondsLeft > 0) && styles.linkDisabled]}>
                {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkRowTight} onPress={changeEmail} disabled={busy}>
              <Text style={styles.linkText}>Use a different email</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.linkRow} onPress={() => router.replace('/(auth)/sign-in')} disabled={busy}>
          <Text style={styles.linkText}>Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 40 },
  logo: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 8, color: '#1565C0' },
  subtitle: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 20 },
  help: { fontSize: 14, color: '#555', textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  emailLine: { fontSize: 14, color: '#222', fontWeight: '600', textAlign: 'center', marginBottom: 12 },
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
  codeInput: { fontSize: 22, letterSpacing: 6, textAlign: 'center', fontWeight: '700' },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginBottom: 12,
  },
  passwordInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: '#222' },
  eyeButton: { paddingHorizontal: 14, paddingVertical: 12 },
  eyeIcon: { fontSize: 18 },
  errorText: { color: '#e53e3e', fontSize: 14, marginBottom: 10, textAlign: 'center', lineHeight: 20 },
  successText: { color: '#1565C0', fontSize: 14, marginBottom: 12, textAlign: 'center', lineHeight: 20 },
  button: {
    backgroundColor: '#1565C0',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkRow: { marginTop: 20, alignItems: 'center' },
  linkRowTight: { marginTop: 12, alignItems: 'center' },
  linkText: { color: '#1565C0', fontSize: 14 },
  linkDisabled: { color: '#999' },
});

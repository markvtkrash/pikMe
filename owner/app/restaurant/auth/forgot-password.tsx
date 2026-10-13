import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/api/supabase';
import { requestPasswordResetCode, verifyRecoveryCode, setNewPassword } from '../../../src/api/passwordReset';
import { useRestaurantOwnerStore } from '../../../src/store/restaurantOwnerStore';
import {
  isValidEmail, normalizeResetCode, isCompleteResetCode, resendSecondsLeft, newPasswordProblem, passwordRequirements,
  RESET_REQUESTED_MESSAGE,
} from '../../../src/utils/passwordReset';
import { BRAND_NAME } from '../../../src/constants/brand';
import { IconText } from '../../../src/components/common/AppIcon';
import { useEnterChain } from '../../../src/hooks/useEnterChain';

// Forgot password: (1) enter the email, (2) enter the 6-digit code from the email plus a new password. Checking the code signs the
// person in briefly so the new password can be saved; the route guard (resolveOwnerRoute) leaves this page alone while that happens.
// When done the session is ended and the owner signs in with the new password.
export default function RestaurantForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const emailChain = useEnterChain(1, () => sendCode(false));
  const codeChain = useEnterChain(3, () => submitNewPassword());

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
        await useRestaurantOwnerStore.getState().logout();
        setError(`${saved.error} Request a new code to try again.`);
        setCode('');
        return;
      }

      // A forced "set a new password" (admin-created account) is satisfied by choosing one here. RLS lets an owner update their own
      // record; for anyone else this matches no row.
      const { data } = await supabase.auth.getUser();
      if (data.user?.id) {
        const { error: flagError } = await supabase
          .from('restaurant_owners')
          .update({ must_change_password: false, updated_at: new Date().toISOString() })
          .eq('id', data.user.id);
        if (flagError) console.error('[password-reset] Failed to clear must_change_password:', flagError);
      }

      await useRestaurantOwnerStore.getState().logout();
      router.replace({ pathname: '/restaurant/auth/login', params: { reset: '1' } });
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

  const requirements = passwordRequirements(password);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.topLeftBar}>
        <Image source={require('../../../assets/logo.png')} style={styles.topLeftLogo} />
      </View>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>{BRAND_NAME}</Text>
        <IconText style={styles.title} emoji="🔐">Reset Password</IconText>
        <Text style={styles.subtitle}>
          {step === 'email'
            ? 'Enter your account email and we will send you a 6-digit code.'
            : 'Enter the code we emailed you and choose a new password.'}
        </Text>

        {step === 'email' ? (
          <>
            <TextInput {...emailChain(0)}
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={(t) => { setEmail(t); setError(''); }}
              editable={!busy}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TouchableOpacity style={[styles.button, busy && styles.buttonDisabled]} onPress={() => sendCode(false)} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send Code</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            {info ? <Text style={styles.infoText}>{info}</Text> : null}
            <Text style={styles.emailLine}>{email.trim()}</Text>

            <TextInput {...codeChain(0)}
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
            <TextInput {...codeChain(1)}
              style={styles.input}
              placeholder="New password"
              placeholderTextColor="#999"
              secureTextEntry
              autoCapitalize="none"
              value={password}
              onChangeText={(t) => { setPassword(t); setError(''); }}
              editable={!busy}
            />
            <View style={styles.requirements}>
              {requirements.map((r) => (
                <Text key={r.label} style={[styles.requirement, r.met && styles.requirementMet]}>
                  {r.met ? '✓' : '○'} {r.label}
                </Text>
              ))}
            </View>
            <TextInput {...codeChain(2)}
              style={styles.input}
              placeholder="Confirm new password"
              placeholderTextColor="#999"
              secureTextEntry
              autoCapitalize="none"
              value={confirm}
              onChangeText={(t) => { setConfirm(t); setError(''); }}
              editable={!busy}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TouchableOpacity style={[styles.button, busy && styles.buttonDisabled]} onPress={submitNewPassword} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Reset Password</Text>}
            </TouchableOpacity>

            <View style={styles.linkRow}>
              <TouchableOpacity onPress={() => sendCode(true)} disabled={busy || secondsLeft > 0}>
                <Text style={[styles.linkText, (busy || secondsLeft > 0) && styles.linkDisabled]}>
                  {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.linkSeparator}>·</Text>
              <TouchableOpacity onPress={changeEmail} disabled={busy}>
                <Text style={styles.linkText}>Use a different email</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <TouchableOpacity style={styles.backRow} onPress={() => router.replace('/restaurant/auth/login')} disabled={busy}>
          <Text style={styles.linkText}>Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  topLeftBar: { paddingTop: 16, paddingLeft: 16 },
  topLeftLogo: { width: 32, height: 32, borderRadius: 16 },
  brand: { fontSize: 15, fontWeight: '700', color: '#1565C0', textAlign: 'center', marginBottom: 4, letterSpacing: 0.5 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#666', textAlign: 'center', marginBottom: 20, lineHeight: 21 },
  infoText: { color: '#1565C0', fontSize: 14, textAlign: 'center', marginBottom: 10, lineHeight: 20 },
  emailLine: { fontSize: 14, color: '#222', fontWeight: '600', textAlign: 'center', marginBottom: 12 },
  input: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, marginBottom: 12, color: '#222', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#B0BEC5', borderRadius: 8 },
  codeInput: { fontSize: 22, letterSpacing: 6, textAlign: 'center', fontWeight: '700' },
  requirements: { marginTop: -4, marginBottom: 10, flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
  requirement: { fontSize: 12, color: '#888', lineHeight: 18 },
  requirementMet: { color: '#2E7D32' },
  errorText: { color: '#e53e3e', fontSize: 14, marginBottom: 10, textAlign: 'center', lineHeight: 20 },
  button: { backgroundColor: '#1565C0', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8, minHeight: 48 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 18, gap: 10 },
  linkText: { color: '#1565C0', fontSize: 14, fontWeight: '700' },
  linkDisabled: { color: '#999' },
  linkSeparator: { color: '#999', fontSize: 14 },
  backRow: { marginTop: 14, alignSelf: 'center', paddingVertical: 9, paddingHorizontal: 18, borderRadius: 10, borderWidth: 1.5, borderColor: '#1565C0', backgroundColor: '#E3F2FD' },
});

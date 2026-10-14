import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getOwnEmail, joinRegionWaitlist, leaveRegionWaitlist } from '../../api/region';
import { comingSoonCopy, isValidEmail, RegionAccess } from '../../utils/regionAccess';
import { BRAND_NAME } from '../../constants/brandTheme';

// Shown instead of restaurants when the customer is standing in a state that is not open yet (Region Management, migration 142). They can leave
// their email to be told when it opens, take it back, or check again (for example after moving).
export function ComingSoon({ access, onCheckAgain, checking }: { access: RegionAccess; onCheckAgain: () => void; checking: boolean }) {
  const insets = useSafeAreaInsets();
  const copy = comingSoonCopy(access);
  const [email, setEmail] = useState('');
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // pre-fill with the customer's own email; they can change it
  useEffect(() => {
    let cancelled = false;
    getOwnEmail().then((e) => { if (!cancelled && e) setEmail((current) => current || e); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function join() {
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await joinRegionWaitlist(email, access.countryCode, copy.waitlistPlace);
      setJoined(true);
    } catch (e: any) {
      setError(e?.message || 'Could not save your email. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    setError(null);
    try {
      await leaveRegionWaitlist(access.countryCode, copy.waitlistPlace);
      setJoined(false);
    } catch (e: any) {
      setError(e?.message || 'Could not remove your email. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 40 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.icon}>🗺️</Text>
        <Text style={styles.brand}>{BRAND_NAME}</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>

        {joined ? (
          <View style={styles.joined}>
            <Text style={styles.joinedText}>✓ You are on the list. We will email {email.trim()} when we open.</Text>
            <TouchableOpacity onPress={leave} disabled={busy} accessibilityRole="button">
              <Text style={styles.link}>{busy ? 'Removing…' : 'Remove my email'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(v) => { setEmail(v); setError(null); }}
              placeholder="Your email"
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              onSubmitEditing={join}
              accessibilityLabel="Your email"
            />
            <TouchableOpacity style={[styles.notify, busy && styles.disabled]} onPress={join} disabled={busy} accessibilityRole="button">
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.notifyText}>Notify me</Text>}
            </TouchableOpacity>
            <Text style={styles.consent}>We will only use your email to tell you when we open here. You can remove it any time.</Text>
          </View>
        )}
        {!!error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={styles.again} onPress={onCheckAgain} disabled={checking} accessibilityRole="button">
          {checking ? <ActivityIndicator size="small" color="#1565C0" /> : <Text style={styles.againText}>Check again</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 28, paddingBottom: 40, alignItems: 'center', width: '100%', maxWidth: 460, alignSelf: 'center' },
  icon: { fontSize: 54, marginBottom: 8 },
  brand: { fontSize: 15, fontWeight: '800', color: '#1565C0', letterSpacing: 0.5, marginBottom: 14 },
  title: { fontSize: 24, fontWeight: '800', color: '#141414', textAlign: 'center', marginBottom: 10 },
  body: { fontSize: 15, color: '#555', textAlign: 'center', lineHeight: 22, marginBottom: 22 },
  form: { width: '100%', gap: 10 },
  input: { borderWidth: 2, borderColor: '#1565C0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#141414', backgroundColor: '#fff' },
  notify: { backgroundColor: '#E65100', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  notifyText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  consent: { fontSize: 12, color: '#888', textAlign: 'center', lineHeight: 17 },
  joined: { width: '100%', alignItems: 'center', gap: 10, backgroundColor: '#E8F5E9', borderRadius: 12, padding: 16 },
  joinedText: { fontSize: 14, fontWeight: '700', color: '#1B5E20', textAlign: 'center', lineHeight: 20 },
  link: { fontSize: 13, fontWeight: '700', color: '#1565C0', textDecorationLine: 'underline' },
  error: { marginTop: 12, fontSize: 13, color: '#C62828', textAlign: 'center' },
  again: { marginTop: 26, paddingVertical: 10, paddingHorizontal: 22 },
  againText: { fontSize: 15, fontWeight: '700', color: '#1565C0' },
});
